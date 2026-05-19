/**
 * Feature Flags and Configuration
 * 
 * Centralized configuration for feature toggles, testing modes, and app settings.
 * Add new flags here as needed for scalability.
 */

import { Dimensions } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * Feature Flags
 * Toggle features on/off for development and testing
 */
export const FeatureFlags = {
  // Testing & Development
  USE_MOCK_DETECTIONS: false, // Set to true to use mock data instead of real API calls
  ENABLE_FACE_MESH: true, // Set to true to enable face mesh detection and overlay
  ENABLE_DEFAULT_FACE_MESH: false, // Set to true to show default mesh overlay, false for class-based mesh
};

/**
 * Mock Detection Configuration
 * Used when USE_MOCK_DETECTIONS is enabled
 */
export const MockDetectionConfig = {
  // Mock detection data for testing different product types
  MOCK_DETECTIONS: [
    {
      class_name: 'lip stick',
      display_name: 'Lip Stick',
      confidence: 0.85,
      bbox: {
        x1: SCREEN_WIDTH * 0.3,
        y1: SCREEN_HEIGHT * 0.4,
        x2: SCREEN_WIDTH * 0.7,
        y2: SCREEN_HEIGHT * 0.6,
      },
      productName: 'Fenty Beauty Pro Filtr Lipstick',
      priceRange: '$30-$40',
    },
    // Uncomment additional mock products to test:
    // {
    //   class_name: 'foundation',
    //   display_name: 'Foundation',
    //   confidence: 0.92,
    //   bbox: {
    //     x1: SCREEN_WIDTH * 0.2,
    //     y1: SCREEN_HEIGHT * 0.3,
    //     x2: SCREEN_WIDTH * 0.6,
    //     y2: SCREEN_HEIGHT * 0.5,
    //   },
    //   productName: 'Maybelline Fit Me Foundation',
    //   priceRange: '$8-$12',
    // },
    // {
    //   class_name: 'eye liner',
    //   display_name: 'Eye Liner',
    //   confidence: 0.78,
    //   bbox: {
    //     x1: SCREEN_WIDTH * 0.4,
    //     y1: SCREEN_HEIGHT * 0.5,
    //     x2: SCREEN_WIDTH * 0.8,
    //     y2: SCREEN_HEIGHT * 0.7,
    //   },
    //   productName: 'Stila Stay All Day Waterproof Liquid Eyeliner',
    //   priceRange: '$22-$28',
    // },
    // {
    //   class_name: 'mascara',
    //   display_name: 'Mascara',
    //   confidence: 0.88,
    //   bbox: {
    //     x1: SCREEN_WIDTH * 0.1,
    //     y1: SCREEN_HEIGHT * 0.6,
    //     x2: SCREEN_WIDTH * 0.5,
    //     y2: SCREEN_HEIGHT * 0.8,
    //   },
    //   productName: 'Benefit They\'re Real! Mascara',
    //   priceRange: '$25-$30',
    // },
  ],

  // Simulate API response delay (in milliseconds)
  MOCK_API_DELAY: 500,
};

/**
 * Simulate mock detection (for testing without API)
 * @returns {Promise<Object>} Mock API response
 */
export const simulateMockDetection = () => {
  return new Promise((resolve) => {
    // Simulate API delay
    setTimeout(() => {
      resolve({
        status: 'success',
        detections: MockDetectionConfig.MOCK_DETECTIONS,
        count: MockDetectionConfig.MOCK_DETECTIONS.length,
      });
    }, MockDetectionConfig.MOCK_API_DELAY);
  });
};

import Constants from 'expo-constants';

/**
 * App Configuration Constants
 */
export const AppConfig = {
  // Detection settings
  DETECTION_CONFIDENCE_THRESHOLD: 0.3, // Lower threshold to show more detections
  DETECTION_INTERVAL: 2000, // Run detection every 2 seconds for live feed
  
  // API settings - loaded from environment variables via app.config.js
  API_BASE_URL_DEV: Constants.expoConfig?.extra?.apiBaseUrlDev || 'http://localhost:8000',
  API_BASE_URL_PROD: Constants.expoConfig?.extra?.apiBaseUrlProd || 'https://your-production-api.com',
};

