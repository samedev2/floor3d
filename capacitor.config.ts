import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.floorvision.ar',
  appName: 'FloorVision AR',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    Camera: {
      promptLabelPhoto: 'Selecionar foto',
      promptLabelPicture: 'Tirar foto',
      saveToGallery: true,
    },
    Filesystem: {
      publicDirectory: 'files',
    },
    Haptics: {
      vibrate: true,
    },
  },
};

export default config;
