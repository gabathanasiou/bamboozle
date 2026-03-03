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
      launchAutoHide: false,
      backgroundColor: '#0f172a',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
