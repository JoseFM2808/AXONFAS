// AXONFAS · configuración de Remotion (la usan `remotion studio` y `remotion render` desde el workdir de video.py).
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
Config.setConcurrency(null);
