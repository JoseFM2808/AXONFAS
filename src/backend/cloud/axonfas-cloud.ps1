<#
.SYNOPSIS
  AXONFAS · manejo del droplet MI300X en AMD Developer Cloud con doctl (TD-04, TD-08, ADR-006, ADR-016).

.DESCRIPTION
  Un solo script para todo el ciclo de una jornada en la GPU:

    check    Solo lee: cuenta, saldo, si la MI300X está habilitada, llave SSH y droplets de AXONFAS. No cuesta nada.
    up       Crea el droplet MI300X x1 (cobra USD 1.99/h desde ese momento hasta 'down'). Pide -Yes.
    deploy   Copia el código y corre bootstrap.sh: modelos, servicios y prueba de humo.
    tunnel   Abre el túnel SSH: LLM en http://127.0.0.1:8000 y voz en http://127.0.0.1:8001 (Ctrl+C lo cierra).
    key      Muestra cómo cargar en esta terminal la clave de los servicios (vive solo en el droplet).
    smoke    Repite la prueba de humo.
    bench    Corre el benchmark de sesiones concurrentes y trae los resultados.
    fetch    Trae los resultados a ~/.axonfas/results/<fecha>.
    status   Droplets de AXONFAS, horas encendidas y costo estimado.
    down     Trae los resultados y DESTRUYE el droplet (con -Snapshot guarda antes una imagen). Pide -Yes.

  Servidor web (ADR-020), en un droplet pequeño SIN GPU (s-1vcpu-1gb, unos USD 0.009/h), etiqueta 'axonfas-web':
    web-up      Crea el droplet con Docker (cloud-init clona el repo público). Pide -Yes.
    web-deploy  Copia tu archivo de entorno (-EnvFile, por defecto ~/.axonfas/axonfas.env) como config/.env.web,
                actualiza el código y levanta Docker Compose con HTTPS (Caddy). Sin AXONFAS_DOMAIN usa <ip>.sslip.io.
    web-down    Respalda la base SQLite en ~/.axonfas/ y DESTRUYE el droplet web. Pide -Yes.

  El token de la nube lo configura el owner con `doctl auth init --context <nombre> --api-url https://api.devcloud.amd.com`;
  este script nunca lo pide ni lo guarda. Todo recurso lleva la etiqueta 'axonfas'.

.EXAMPLE
  .\axonfas-cloud.ps1 check -Context amd
  .\axonfas-cloud.ps1 up -Yes
  .\axonfas-cloud.ps1 deploy
  .\axonfas-cloud.ps1 bench -Levels 1,2,4,8,16,32 -Duration 60
  .\axonfas-cloud.ps1 down -Yes
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0, Mandatory = $true)]
  [ValidateSet('check', 'up', 'deploy', 'tunnel', 'key', 'smoke', 'bench', 'fetch', 'status', 'down', 'web-up', 'web-deploy', 'web-down')]
  [string]$Command,
  [string]$Context = 'amd-write',
  [string]$Region = 'atl1',
  [string]$Size = 'gpu-mi300x1-192gb-devcloud',
  [string]$Image = '242825161',                       # Quick Start "vLLM 0.27.1 + vLLM-Omni (ROCm 7.14)"
  [string]$SshKey = (Join-Path $HOME '.ssh\axonfas_amd'),
  [string]$Name = 'axonfas-gpu',
  [int[]]$Levels = @(1, 2, 4, 8, 16, 32, 64),
  [int]$Duration = 60,
  [switch]$Snapshot,
  [string]$WebSize = 's-1vcpu-1gb',
  [string]$EnvFile = (Join-Path $HOME '.axonfas\axonfas.env'),
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$ApiUrl = 'https://api.devcloud.amd.com'
$Tag = 'axonfas'
$PricePerHour = 1.99
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')          # carpeta del proyecto
$Local = Join-Path $HOME '.axonfas'                                  # fuera del repo y de Drive

function Invoke-Doctl {
  # Función simple (sin param): así PowerShell no confunde las opciones de doctl (-o, --wait…) con las suyas.
  $out = & doctl @args --context $Context --api-url $ApiUrl 2>&1
  if ($LASTEXITCODE -ne 0) { throw "doctl $($args -join ' ') falló: $out" }
  return $out
}

function Get-DoctlJson {
  $text = (Invoke-Doctl @args --output json) -join "`n"
  if (-not $text.Trim()) { return }
  # En PowerShell 5.1 ConvertFrom-Json entrega un arreglo como un solo objeto: se recorre para devolver sus elementos
  # (un arreglo vacío no devuelve nada, y quien llama lo envuelve en @()).
  foreach ($item in (ConvertFrom-Json $text)) { $item }
}

function Get-AxonDroplets { Get-DoctlJson compute droplet list --tag-name $Tag }

# Servidor web (ADR-020): etiqueta propia para que su firewall (22, 80 y 443) no choque con el de la GPU (solo 22).
$WebTag = 'axonfas-web'
$WebName = 'axonfas-web'
$WebPricePerHour = 0.009
function Get-WebDroplets { Get-DoctlJson compute droplet list --tag-name $WebTag }

function Get-WebTarget {
  $d = @(Get-WebDroplets)
  if ($d.Count -eq 0) { throw "No hay droplet web. Créalo con: .\axonfas-cloud.ps1 web-up -Yes" }
  $ip = Get-Ip $d[0]
  if (-not $ip) { throw "El droplet web todavía no tiene IP pública." }
  return @{ Droplet = $d[0]; Ip = $ip }
}

function Get-SshKeyId {
  $pub = "$SshKey.pub"
  if (-not (Test-Path $pub)) { throw "Falta la llave $pub. Créala con: ssh-keygen -t ed25519 -C axonfas-amd -f `"$SshKey`"" }
  $mine = (Get-Content $pub -Raw).Trim().Split(' ')[0..1] -join ' '
  $known = @(Get-DoctlJson compute ssh-key list | Where-Object { ($_.public_key.Trim().Split(' ')[0..1] -join ' ') -eq $mine })
  if ($known.Count -eq 0) { $known = @(Get-DoctlJson compute ssh-key import axonfas-amd --public-key-file $pub) }
  return $known[0].id
}

function Get-SslipDomain([string]$ip) { ($ip -replace '\.', '-') + '.sslip.io' }

function Get-Ip($droplet) {
  ($droplet.networks.v4 | Where-Object { $_.type -eq 'public' } | Select-Object -First 1).ip_address
}

function Get-Target {
  $d = @(Get-AxonDroplets)
  if ($d.Count -eq 0) { throw "No hay ningún droplet de AXONFAS. Créalo con: .\axonfas-cloud.ps1 up -Yes" }
  if ($d.Count -gt 1) { Write-Warning "Hay $($d.Count) droplets con la etiqueta '$Tag'; uso el primero." }
  $ip = Get-Ip $d[0]
  if (-not $ip) { throw "El droplet $($d[0].name) todavía no tiene IP pública." }
  return @{ Droplet = $d[0]; Ip = $ip }
}

function SshArgs { @('-i', $SshKey, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30') }

function Invoke-Remote([string]$ip, [string]$cmd) {
  $a = (SshArgs) + @("root@$ip", $cmd)
  & ssh @a
  if ($LASTEXITCODE -ne 0) { throw "El comando remoto falló ($LASTEXITCODE): $cmd" }
}

function Show-Cost($droplet, [double]$price = $PricePerHour) {
  $created = [datetime]::Parse($droplet.created_at).ToUniversalTime()
  $hours = ((Get-Date).ToUniversalTime() - $created).TotalHours
  '{0}: {1:N2} h encendido, unos USD {2:N2} hasta ahora (USD {3}/h hasta destruirlo)' -f $droplet.name, $hours, ($hours * $price), $price
}

function Test-GpuEnabled {
  $sizes = Get-DoctlJson compute size list
  return [bool]($sizes | Where-Object { $_.slug -eq $Size })
}

function Get-Fetch([string]$ip) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $dest = Join-Path $Local "results\$stamp"
  New-Item -ItemType Directory -Force $dest | Out-Null
  $a = (SshArgs) + @('-r', "root@${ip}:/root/axonfas/results", $dest)
  & scp @a
  if ($LASTEXITCODE -ne 0) { Write-Warning 'No se pudieron traer los resultados (¿todavía no hay?).'; return $null }
  Write-Host "Resultados en $dest"
  return $dest
}

switch ($Command) {
  'check' {
    Write-Host '== Cuenta'; Invoke-Doctl account get
    Write-Host '== Saldo (negativo = a favor)'; Invoke-Doctl balance get
    $gpu = Test-GpuEnabled
    Write-Host ('== MI300X ({0}) habilitada para la cuenta: {1}' -f $Size, $(if ($gpu) { 'SÍ' } else { 'NO — falta que AMD apruebe el acceso' }))
    $regions = Get-DoctlJson compute region list
    $r = $regions | Where-Object { $_.slug -eq $Region }
    Write-Host ('== Región {0} la ofrece: {1}' -f $Region, $(if ($r -and ($r.sizes -contains $Size)) { 'sí' } else { 'no' }))
    $pub = "$SshKey.pub"
    if (Test-Path $pub) {
      $mine = (Get-Content $pub -Raw).Trim().Split(' ')[0..1] -join ' '
      $keys = Get-DoctlJson compute ssh-key list
      $known = $keys | Where-Object { ($_.public_key.Trim().Split(' ')[0..1] -join ' ') -eq $mine }
      Write-Host ('== Llave SSH {0}: {1}' -f $pub, $(if ($known) { "registrada como '$($known[0].name)'" } else { "no registrada (up la registra)" }))
    } else {
      Write-Host "== Llave SSH: falta $pub. Créala con: ssh-keygen -t ed25519 -C axonfas-amd -f `"$SshKey`""
    }
    $d = @(Get-AxonDroplets)
    if ($d.Count -eq 0) { Write-Host '== Droplets de AXONFAS: ninguno (no se está cobrando nada)' }
    else { $d | ForEach-Object { Write-Host "== Droplet: $(Show-Cost $_)  IP $(Get-Ip $_)" } }
  }

  'up' {
    if (-not $Yes) { throw "Crear el droplet cobra USD $PricePerHour/h hasta destruirlo. Repite con -Yes si estás de acuerdo." }
    if (@(Get-AxonDroplets).Count -gt 0) { throw "Ya hay un droplet de AXONFAS. Mira 'status' o destrúyelo con 'down -Yes'." }
    if (-not (Test-GpuEnabled)) { throw "La MI300X ($Size) todavía no está habilitada para la cuenta. Espera la aprobación de AMD." }
    $pub = "$SshKey.pub"
    if (-not (Test-Path $pub)) { throw "Falta la llave $pub. Créala con: ssh-keygen -t ed25519 -C axonfas-amd -f `"$SshKey`"" }
    $mine = (Get-Content $pub -Raw).Trim().Split(' ')[0..1] -join ' '
    $known = @(Get-DoctlJson compute ssh-key list | Where-Object { ($_.public_key.Trim().Split(' ')[0..1] -join ' ') -eq $mine })
    if ($known.Count -eq 0) { $known = @(Get-DoctlJson compute ssh-key import axonfas-amd --public-key-file $pub) }
    $keyId = $known[0].id
    try { Invoke-Doctl compute tag create $Tag | Out-Null } catch { }       # ya existía
    $fw = @(Get-DoctlJson compute firewall list | Where-Object { $_.name -eq 'axonfas-fw' })
    if ($fw.Count -eq 0) {
      try {
        Invoke-Doctl compute firewall create --name axonfas-fw --tag-names $Tag `
          --inbound-rules 'protocol:tcp,ports:22,address:0.0.0.0/0,address:::/0' `
          --outbound-rules 'protocol:icmp,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:all,address:0.0.0.0/0,address:::/0 protocol:udp,ports:all,address:0.0.0.0/0,address:::/0' | Out-Null
        Write-Host 'Firewall axonfas-fw: solo SSH (22) desde afuera; el LLM y la voz se usan por el túnel.'
      } catch { Write-Warning "No se pudo crear el firewall de la nube: $_. Los servicios igual piden clave y escuchan solo en la red interna." }
    }
    Write-Host "Creando $Name ($Size, $Region, imagen $Image). Cobra desde ahora: USD $PricePerHour/h."
    $d = Get-DoctlJson compute droplet create $Name --region $Region --size $Size --image $Image --ssh-keys $keyId --tag-names $Tag --wait
    $ip = Get-Ip $d[0]
    Write-Host "Listo: $($d[0].name)  IP $ip"
    Write-Host 'Siguiente: .\axonfas-cloud.ps1 deploy   (espera 1-2 min a que arranque SSH)'
  }

  'deploy' {
    $t = Get-Target
    Invoke-Remote $t.Ip 'mkdir -p /root/axonfas'
    $src = @((Join-Path $Root 'src\agents'), (Join-Path $Root 'src\backend\gpu'))
    $a = (SshArgs) + @('-r') + $src + @("root@$($t.Ip):/root/axonfas/")
    & scp @a
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo copiar el código al droplet.' }
    Invoke-Remote $t.Ip "sed -i 's/\r$//' /root/axonfas/gpu/*.sh && bash /root/axonfas/gpu/bootstrap.sh"
    Get-Fetch $t.Ip | Out-Null
    Write-Host (Show-Cost $t.Droplet)
  }

  'tunnel' {
    $t = Get-Target
    $hostIn = ((& ssh @((SshArgs) + @("root@$($t.Ip)", 'cat /root/axonfas/tunnel_host'))) -join '').Trim()
    if (-not $hostIn) { throw 'Primero corre deploy.' }
    Write-Host "Túnel abierto: LLM http://127.0.0.1:8000/v1 · voz http://127.0.0.1:8001 · Ctrl+C lo cierra"
    $a = (SshArgs) + @('-N', '-L', "8000:${hostIn}:8000", '-L', "8001:${hostIn}:8001", "root@$($t.Ip)")
    & ssh @a
  }

  'key' {
    $t = Get-Target
    Write-Host 'Para usar el LLM y la voz desde esta PC (con el túnel abierto en otra terminal), pega esto en PowerShell:'
    Write-Host ''
    Write-Host "  `$env:AXONFAS_LLM_KEY = (ssh -i `"$SshKey`" root@$($t.Ip) cat /root/axonfas/.api_key)"
    Write-Host ''
    Write-Host 'La clave queda solo en esa terminal; no la guardes en archivos del proyecto.'
  }

  'smoke' {
    $t = Get-Target
    Invoke-Remote $t.Ip 'bash /root/axonfas/gpu/run.sh smoke'
    Get-Fetch $t.Ip | Out-Null
  }

  'bench' {
    $t = Get-Target
    Write-Host ("Benchmark: niveles {0}, {1} s cada uno (unos {2} min). {3}" -f ($Levels -join ','), $Duration, [math]::Ceiling($Levels.Count * $Duration / 60 + 1), (Show-Cost $t.Droplet))
    Invoke-Remote $t.Ip ("bash /root/axonfas/gpu/run.sh bench --levels {0} --duration {1}" -f ($Levels -join ','), $Duration)
    Get-Fetch $t.Ip | Out-Null
  }

  'fetch' { $t = Get-Target; Get-Fetch $t.Ip | Out-Null }

  'status' {
    $d = @(Get-AxonDroplets)
    $w = @(Get-WebDroplets)
    if ($d.Count -eq 0 -and $w.Count -eq 0) { Write-Host 'Ningún droplet de AXONFAS: no se está cobrando nada.' }
    $d | ForEach-Object { Write-Host "GPU: $(Show-Cost $_)  IP $(Get-Ip $_)  estado $($_.status)" }
    $w | ForEach-Object { Write-Host "Web: $(Show-Cost $_ $WebPricePerHour)  https://$(Get-SslipDomain (Get-Ip $_))  estado $($_.status)" }
  }

  'web-up' {
    if (-not $Yes) { throw "Crear el droplet web cobra unos USD $WebPricePerHour/h ($WebSize) hasta destruirlo. Repite con -Yes." }
    if (@(Get-WebDroplets).Count -gt 0) { throw "Ya hay un droplet web. Usa 'web-deploy' o 'web-down -Yes'." }
    $keyId = Get-SshKeyId
    try { Invoke-Doctl compute tag create $WebTag | Out-Null } catch { }
    if (@(Get-DoctlJson compute firewall list | Where-Object { $_.name -eq 'axonfas-web-fw' }).Count -eq 0) {
      try {
        Invoke-Doctl compute firewall create --name axonfas-web-fw --tag-names $WebTag `
          --inbound-rules 'protocol:tcp,ports:22,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:80,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:443,address:0.0.0.0/0,address:::/0' `
          --outbound-rules 'protocol:icmp,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:all,address:0.0.0.0/0,address:::/0 protocol:udp,ports:all,address:0.0.0.0/0,address:::/0' | Out-Null
      } catch { Write-Warning "Sin firewall de la nube: $_. El droplet igual activa ufw (22, 80, 443) con cloud-init." }
    }
    $init = Join-Path $Root 'config\deploy\cloud-init.yml'
    Write-Host "Creando $WebName ($WebSize, $Region, Ubuntu 24.04 + Docker)…"
    $d = Get-DoctlJson compute droplet create $WebName --region $Region --size $WebSize --image ubuntu-24-04-x64 `
      --ssh-keys $keyId --tag-names $WebTag --user-data-file $init --wait
    $ip = Get-Ip $d[0]
    Write-Host "Listo: $WebName  IP $ip"
    Write-Host "Dominio sin comprar: $(Get-SslipDomain $ip)  (agrégalo como origen autorizado del Client ID de Google)"
    Write-Host 'Siguiente: .\axonfas-cloud.ps1 web-deploy   (espera 2-3 min a que cloud-init instale Docker)'
  }

  'web-deploy' {
    $t = Get-WebTarget
    if (-not (Test-Path $EnvFile)) { throw "Falta $EnvFile. Cópialo de config\.env.web.example y complétalo (Google, administradores, Token Factory)." }
    $domain = Get-SslipDomain $t.Ip
    $lines = @(Get-Content $EnvFile | Where-Object { $_ -notmatch '^\s*AXONFAS_DOMAIN\s*=\s*$' })
    if (-not ($lines | Where-Object { $_ -match '^\s*AXONFAS_DOMAIN\s*=\s*\S' })) { $lines += "AXONFAS_DOMAIN=$domain" } else {
      $domain = (($lines | Where-Object { $_ -match '^\s*AXONFAS_DOMAIN\s*=' } | Select-Object -First 1) -split '=', 2)[1].Trim()
    }
    $tmp = Join-Path $env:TEMP "axonfas-env-$PID"
    [System.IO.File]::WriteAllText($tmp, (($lines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding $false))
    try {
      Write-Host 'Esperando a cloud-init (Docker y el repo)…'
      Invoke-Remote $t.Ip 'for i in $(seq 1 60); do [ -f /opt/axonfas/.cloud-init-done ] && exit 0; sleep 5; done; echo "cloud-init no terminó"; exit 1'
      $a = (SshArgs) + @($tmp, "root@$($t.Ip):/opt/axonfas/config/.env.web")
      & scp @a
      if ($LASTEXITCODE -ne 0) { throw 'No se pudo copiar el archivo de entorno.' }
    } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
    Invoke-Remote $t.Ip 'chmod 600 /opt/axonfas/config/.env.web && cd /opt/axonfas && git pull --ff-only && cd config/deploy && docker compose --env-file ../.env.web up -d --build'
    Write-Host "Probando https://$domain …"
    Start-Sleep -Seconds 10
    try {
      $r = Invoke-RestMethod -Uri "https://$domain/api/auth/config" -TimeoutSec 30
      Write-Host ("Funcionando: Google {0} · cuentas de demostración {1} · IA {2}" -f $(if ($r.google_client_id) { 'sí' } else { 'falta GOOGLE_CLIENT_ID' }), $r.demo_accounts, $(if ($r.ai_provider) { $r.ai_provider } else { 'sin configurar' }))
    } catch { Write-Warning "Todavía no responde por HTTPS (el certificado tarda 1-2 min la primera vez): $_" }
    Write-Host "Web: https://$domain   ·   $(Show-Cost $t.Droplet $WebPricePerHour)"
  }

  'web-down' {
    if (-not $Yes) { throw 'Esto destruye el droplet web y su base de datos (se respalda antes en ~/.axonfas). Repite con -Yes.' }
    $w = @(Get-WebDroplets)
    if ($w.Count -eq 0) { Write-Host 'No hay droplet web.'; break }
    foreach ($x in $w) {
      $ip = Get-Ip $x
      if ($ip) {
        $backup = Join-Path $Local ("web-backup-{0}.sqlite3" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
        $a = (SshArgs) + @("root@${ip}:/var/lib/docker/volumes/deploy_axonfas-data/_data/staging.sqlite3", $backup)
        & scp @a
        if ($LASTEXITCODE -eq 0) { Write-Host "Base respaldada en $backup" } else { Write-Warning 'No se pudo respaldar la base.' }
      }
      Write-Host (Show-Cost $x $WebPricePerHour)
      Invoke-Doctl compute droplet delete $x.id --force | Out-Null
      Write-Host "Destruido: $($x.name). Ya no cobra."
    }
  }

  'down' {
    if (-not $Yes) { throw 'Esto destruye el droplet y todo lo que tenga adentro. Repite con -Yes.' }
    $d = @(Get-AxonDroplets)
    if ($d.Count -eq 0) { Write-Host 'No hay droplets de AXONFAS.'; break }
    foreach ($x in $d) {
      $ip = Get-Ip $x
      if ($ip) { try { Get-Fetch $ip | Out-Null } catch { Write-Warning "Sin resultados de $($x.name): $_" } }
      if ($Snapshot) {
        $snap = 'axonfas-' + (Get-Date -Format 'yyyyMMdd-HHmm')
        Write-Host "Snapshot $snap (cobra almacenamiento; bórralo cuando no lo necesites)…"
        Invoke-Doctl compute droplet-action snapshot $x.id --snapshot-name $snap --wait | Out-Null
      }
      Write-Host (Show-Cost $x)
      Invoke-Doctl compute droplet delete $x.id --force | Out-Null
      Write-Host "Destruido: $($x.name). Ya no cobra."
    }
  }
}
