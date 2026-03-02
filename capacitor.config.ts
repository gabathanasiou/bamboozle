import type { CapacitorConfig } from '@capacitor/cli';

// Set this to true if you are testing locally with hot reload
const IS_DEV = false;

const config: CapacitorConfig = {
  appId: 'com.bamboozle.app',
  appName: 'Bamboozle',
  webDir: 'dist',
  server: IS_DEV ? {
    // Development: Live reload from your Mac
    url: 'http://192.168.0.213:3000',
    cleartext: true
  } : {
    // Production: Bundled code (Works offline / shows custom error)
    // No 'url' here means Capacitor loads the 'dist' folder locally.
    cleartext: true
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#0f0f23',
      showSpinner: false,
    },
  },
};

export default config;
