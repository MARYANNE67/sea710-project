/**
 * Product Detection Camera Screen
 * Real-time camera interface for detecting makeup products using YOLOv8 model
 * Displays bounding boxes, product information, and allows navigation to virtual try-on
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import { detectProducts, getHealthStatus } from '../services/api';
import ProductCard from '../components/ProductCard';
import { normalizeClassName, getDisplayName } from '../utils/productClasses';
import { FeatureFlags, simulateMockDetection, AppConfig } from '../config/featureFlags';

// API URL configuration
const API_BASE_URL = __DEV__
  ? AppConfig.API_BASE_URL_DEV
  : AppConfig.API_BASE_URL_PROD;

const DETECTION_CONFIDENCE_THRESHOLD = AppConfig.DETECTION_CONFIDENCE_THRESHOLD;
const DETECTION_INTERVAL = AppConfig.DETECTION_INTERVAL;
const USE_MOCK_DETECTIONS = FeatureFlags.USE_MOCK_DETECTIONS;

// Transform API detection format to our Detection type
// imageShape: { width, height } from API response
// cameraViewSize: { width, height } of the camera view
const transformDetection = (apiDetection, index, imageShape, cameraViewSize) => {
  const bbox = apiDetection.bbox || {};
  
  // Normalize class name using enum
  const rawClassName = apiDetection.class_name || apiDetection.raw_class_name || 'Unknown';
  const normalizedClass = normalizeClassName(rawClassName);
  const displayName = apiDetection.display_name || getDisplayName(normalizedClass || rawClassName);
  
  // Scale bounding box coordinates from image dimensions to camera view dimensions
  let x = bbox.x1 || 0;
  let y = bbox.y1 || 0;
  let width = (bbox.x2 || 0) - (bbox.x1 || 0);
  let height = (bbox.y2 || 0) - (bbox.y1 || 0);
  
  // Scale coordinates if we have both image and camera view dimensions
  if (imageShape && cameraViewSize && imageShape.width > 0 && imageShape.height > 0) {
    const scaleX = cameraViewSize.width / imageShape.width;
    const scaleY = cameraViewSize.height / imageShape.height;
    
    x = x * scaleX;
    y = y * scaleY;
    width = width * scaleX;
    height = height * scaleY;
  }
  
  return {
    id: `detection-${index}-${Date.now()}`,
    label: normalizedClass || rawClassName, // Use normalized enum value
    displayName: displayName, // Human-readable name
    // Use productName from API/mock if available, otherwise generate from displayName
    productName: apiDetection.productName || (displayName ? `${displayName} Product` : undefined),
    productImageUrl: apiDetection.productImageUrl || undefined,
    boundingBox: {
      x: x,
      y: y,
      width: width,
      height: height,
    },
    confidence: apiDetection.confidence || 0,
    // Use priceRange from API/mock if available
    priceRange: apiDetection.priceRange || undefined,
  };
};

export default function ScanProductScreen({ navigation }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraType, setCameraType] = useState('back');
  const [detections, setDetections] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [isDetecting, setIsDetecting] = useState(false);
  // Initialize API status based on mock mode
  const [apiStatus, setApiStatus] = useState(USE_MOCK_DETECTIONS ? 'ready' : 'unknown');
  const [confidence] = useState(0.25);
  const [errorMessage, setErrorMessage] = useState(null);
  const [lastDetectionCount, setLastDetectionCount] = useState(0);
  const cameraRef = useRef(null);
  const detectionIntervalRef = useRef(null);
  const cameraViewSizeRef = useRef({ width: 0, height: 0 });
  const apiStatusRef = useRef(apiStatus);
  const isDetectingRef = useRef(isDetecting);

  // Use focus effect to start/stop detection when screen is focused
  useFocusEffect(
    React.useCallback(() => {
      console.log('[Detection] Screen focused - starting detection');
      
      // Skip API health check in mock mode
      if (!USE_MOCK_DETECTIONS) {
        console.log('[Detection] Checking API health...');
        checkApiHealth();
      } else {
        // Set status to 'ready' in mock mode so UI shows as ready
        console.log('[Detection] Mock mode - setting status to ready');
        setApiStatus('ready');
      }
      
      // Start continuous detection
      startContinuousDetection();

      // Cleanup when screen loses focus
      return () => {
        console.log('[Detection] Screen blurred - stopping detection');
        if (detectionIntervalRef.current) {
          clearInterval(detectionIntervalRef.current);
          detectionIntervalRef.current = null;
        }
        // Clear detections when leaving screen
        setDetections([]);
        setSelectedProduct(null);
      };
    }, [])
  );

  // Update refs when state changes
  useEffect(() => {
    apiStatusRef.current = apiStatus;
    console.log('[Detection] apiStatus updated in ref to:', apiStatus);
  }, [apiStatus]);

  useEffect(() => {
    isDetectingRef.current = isDetecting;
  }, [isDetecting]);

  const checkApiHealth = async () => {
    try {
      console.log('[Detection] Checking API health at:', API_BASE_URL);
      const health = await getHealthStatus(API_BASE_URL);
      const newStatus = health.model_loaded ? 'ready' : 'no_model';
      console.log('[Detection] API health check result:', health, 'setting status to:', newStatus);
      setApiStatus(newStatus);
      apiStatusRef.current = newStatus;
    } catch (error) {
      console.error('[Detection] API health check failed:', error);
      setApiStatus('offline');
      apiStatusRef.current = 'offline';
    }
  };

  const startContinuousDetection = () => {
    console.log('[Detection] Starting continuous detection interval');
    detectionIntervalRef.current = setInterval(() => {
      // Use refs to get current values (avoid closure issues)
      const currentApiStatus = apiStatusRef.current;
      const currentlyDetecting = isDetectingRef.current;
      
      console.log('[Detection] Interval tick - isDetecting:', currentlyDetecting, 'apiStatus:', currentApiStatus, 'cameraRef:', !!cameraRef.current);
      
      // In mock mode, don't check API status
      if (USE_MOCK_DETECTIONS) {
        if (!currentlyDetecting) {
          console.log('[Detection] Mock mode - calling captureAndDetect');
          captureAndDetect();
        } else {
          console.log('[Detection] Mock mode - already detecting, skipping');
        }
      } else {
        // Check conditions for real detection
        if (currentlyDetecting) {
          console.log('[Detection] Already detecting, skipping');
          return;
        }
        if (!cameraRef.current) {
          console.log('[Detection] Camera ref not available, skipping');
          return;
        }
        if (currentApiStatus !== 'ready') {
          console.log('[Detection] API not ready, status:', currentApiStatus, '- skipping');
          return;
        }
        console.log('[Detection] All conditions met - calling captureAndDetect');
        captureAndDetect();
      }
    }, DETECTION_INTERVAL);
  };

  const captureAndDetect = async () => {
    console.log('[Detection] captureAndDetect called');
    
    if (!USE_MOCK_DETECTIONS && (!cameraRef.current || isDetecting)) {
      console.log('[Detection] Early return - cameraRef:', !!cameraRef.current, 'isDetecting:', isDetecting);
      return;
    }

    console.log('[Detection] Setting isDetecting to true');
    setIsDetecting(true);
    isDetectingRef.current = true;
    try {
      let result;

      // Use mock data for testing (when feature flag is enabled)
      if (USE_MOCK_DETECTIONS) {
        console.log('[MOCK MODE] Using mock detection data');
        result = await simulateMockDetection();
      } else {
        console.log('[Detection] Capturing photo from camera...');
        // Real API call - capture frame from live camera feed
        // Optimized for live feed: skipProcessing and lower quality for faster capture
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.5, // Lower quality for faster processing and upload
          base64: false, // Use URI for compatibility
          skipProcessing: true, // Skip processing for faster capture from live feed
        });

        console.log('[Detection] Photo captured, URI:', photo.uri?.substring(0, 50));
        console.log('[Detection] Calling detectProducts API...');

        // Process the captured frame from live feed
        result = await detectProducts(API_BASE_URL, photo.uri, confidence);
        
        console.log('[Detection] API call completed, result:', result?.status);
      }

      if (result.status === 'success') {
        console.log(`[Detection] API returned ${result.detections?.length || 0} detections`);
        console.log(`[Detection] Image shape:`, result.image_shape);
        
        if (result.detections && result.detections.length > 0) {
          // Get image dimensions from API response
          const imageShape = result.image_shape || null;
          const cameraViewSize = cameraViewSizeRef.current;
          
          console.log(`[Detection] Before filtering: ${result.detections.length} detections`);
          console.log(`[Detection] Confidence threshold: ${DETECTION_CONFIDENCE_THRESHOLD}`);
          
          const transformedDetections = result.detections
            .map((det, idx) => {
              console.log(`[Detection] Raw detection ${idx}:`, {
                class: det.class_name || det.raw_class_name,
                confidence: det.confidence,
                bbox: det.bbox
              });
              return transformDetection(det, idx, imageShape, cameraViewSize);
            })
            .filter(det => {
              const passes = det.confidence >= DETECTION_CONFIDENCE_THRESHOLD;
              if (!passes) {
                console.log(`[Detection] Filtered out: ${det.displayName} (confidence: ${det.confidence} < ${DETECTION_CONFIDENCE_THRESHOLD})`);
              }
              return passes;
            });

          console.log(`[Detection] After filtering: ${transformedDetections.length} detections`);
          console.log(`[Detection] Transformed detections:`, transformedDetections.map(d => ({
            name: d.displayName,
            confidence: d.confidence,
            bbox: d.boundingBox
          })));

          setDetections(transformedDetections);
          setLastDetectionCount(transformedDetections.length);
          setErrorMessage(null);

          // Auto-select highest confidence detection if none selected
          if (transformedDetections.length > 0 && !selectedProduct) {
            const highestConf = transformedDetections.reduce((prev, current) =>
              prev.confidence > current.confidence ? prev : current
            );
            setSelectedProduct(highestConf);
          }
        } else {
          console.log('[Detection] No detections in API response');
          setDetections([]);
          setLastDetectionCount(0);
          setErrorMessage('No products detected. Try pointing at a makeup product.');
        }
      } else {
        console.error('[Detection] API returned non-success status:', result);
        setErrorMessage('Detection failed. Please try again.');
      }
    } catch (error) {
      console.error('[Detection] Error:', error);
      setErrorMessage(`Error: ${error.message || 'Unknown error'}`);
      setDetections([]);
    } finally {
      setIsDetecting(false);
      isDetectingRef.current = false;
    }
  };

  const handleBoundingBoxPress = (detection) => {
    setSelectedProduct(detection);
  };

  const handleDismissCard = () => {
    setSelectedProduct(null);
  };

  const handleTryVirtualLook = (product) => {
    // Products that don't support virtual try-on
    const NO_VIRTUAL_TRYON_PRODUCTS = ['brush', 'eyelash curler', 'beauty blender'];
    const productType = product.label?.toLowerCase() || '';
    
    // Prevent navigation for products that don't support virtual try-on
    if (NO_VIRTUAL_TRYON_PRODUCTS.includes(productType)) {
      console.log('[Navigation] Virtual try-on not available for:', productType);
      return;
    }
    
    // Normalize product type to ensure it matches mesh overlay keys
    const normalizedType = normalizeClassName(product.label) || product.label;
    console.log('[Navigation] Navigating to VirtualTryOn with product:', {
      originalLabel: product.label,
      normalizedType: normalizedType,
      productName: product.productName,
    });
    
    navigation.navigate('VirtualTryOn', {
      productType: normalizedType, // Use normalized type for consistent mesh mapping
      productName: product.productName || product.displayName || product.label,
      productImageUrl: product.productImageUrl,
    });
  };

  const getStatusColor = () => {
    switch (apiStatus) {
      case 'ready':
        return '#4CAF50';
      case 'no_model':
        return '#FF9800';
      case 'offline':
        return '#F44336';
      default:
        return '#9E9E9E';
    }
  };

  const getStatusText = () => {
    switch (apiStatus) {
      case 'ready':
        return 'API Ready';
      case 'no_model':
        return 'No Model Loaded';
      case 'offline':
        return 'API Offline';
      default:
        return 'Checking...';
    }
  };

  if (!permission) {
    return (
      <View style={styles.container}>
        <Text>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>No access to camera</Text>
        <Text style={styles.errorSubtext}>
          Please enable camera permissions in your device settings
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={requestPermission}
        >
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      
      {/* API Status Bar */}
      {!USE_MOCK_DETECTIONS && (
        <View style={[styles.statusBar, { backgroundColor: getStatusColor() }]}>
          <Text style={styles.statusText}>{getStatusText()}</Text>
          {isDetecting && <ActivityIndicator size="small" color="#fff" style={{ marginLeft: 10 }} />}
        </View>
      )}

      {/* Camera View */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={cameraType}
        ratio="16:9"
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          cameraViewSizeRef.current = { width, height };
          console.log(`[Camera] View size: ${width}x${height}`);
        }}
      >
        <View style={styles.cameraOverlay}>
          {/* Helper Text Overlay */}
          {!selectedProduct && (
            <View style={styles.helperTextContainer}>
              <Text style={styles.helperText}>
                {USE_MOCK_DETECTIONS
                  ? 'MOCK MODE: Testing with sample detections'
                  : apiStatus === 'ready' 
                  ? isDetecting 
                    ? 'Detecting products...' 
                    : errorMessage
                    ? errorMessage
                    : lastDetectionCount > 0
                    ? `${lastDetectionCount} product(s) detected`
                    : 'Point camera at a makeup product'
                  : apiStatus === 'no_model'
                  ? 'Waiting for model to load...'
                  : 'Connecting to server...'}
              </Text>
              {(USE_MOCK_DETECTIONS || (apiStatus === 'ready' && !isDetecting && !errorMessage)) && (
                <Text style={styles.helperSubtext}>
                  {lastDetectionCount > 0 
                    ? 'Tap on detected products to view details'
                    : 'Make sure the product is well-lit and clearly visible'}
                </Text>
              )}
            </View>
          )}

          {/* Bounding Boxes Overlay */}
          {detections.map((detection) => {
            const { x, y, width, height } = detection.boundingBox;
            const isSelected = selectedProduct?.id === detection.id;
            
            // Validate bounding box dimensions
            if (!width || !height || width <= 0 || height <= 0) {
              console.warn(`[Detection] Invalid bounding box for ${detection.displayName}:`, { x, y, width, height });
              return null;
            }
            
            return (
              <TouchableOpacity
                key={detection.id}
                style={[
                  styles.boundingBox,
                  {
                    left: Math.max(0, x),
                    top: Math.max(0, y),
                    width: Math.max(10, width),
                    height: Math.max(10, height),
                    borderColor: isSelected ? '#4CAF50' : '#FFD700',
                    borderWidth: isSelected ? 3 : 2,
                  },
                ]}
                onPress={() => handleBoundingBoxPress(detection)}
                activeOpacity={0.8}
              >
                <View style={styles.labelContainer}>
                  <Text style={styles.labelText} numberOfLines={1}>
                    {detection.displayName || detection.label}
                  </Text>
                  <Text style={styles.confidenceText}>
                    {(detection.confidence * 100).toFixed(0)}%
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </CameraView>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={styles.controlButton}
          onPress={() => setCameraType(cameraType === 'back' ? 'front' : 'back')}
        >
          <Text style={styles.controlButtonText}>Flip</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.controlButton}
          onPress={() => {
            setDetections([]);
            setSelectedProduct(null);
          }}
        >
          <Text style={styles.controlButtonText}>Clear</Text>
        </TouchableOpacity>
      </View>

      {/* Product Card */}
      {selectedProduct && (
        <ProductCard
          product={selectedProduct}
          onDismiss={handleDismissCard}
          onTryVirtualLook={handleTryVirtualLook}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  statusBar: {
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  helperTextContainer: {
    position: 'absolute',
    bottom: 120,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  helperText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    overflow: 'hidden',
  },
  helperSubtext: {
    color: '#fff',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 15,
    overflow: 'hidden',
  },
  boundingBox: {
    position: 'absolute',
    backgroundColor: 'transparent',
  },
  labelContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    maxWidth: 200,
  },
  labelText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  confidenceText: {
    color: '#FFD700',
    fontSize: 10,
    marginTop: 2,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  controlButton: {
    padding: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    minWidth: 80,
    alignItems: 'center',
  },
  controlButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  errorText: {
    fontSize: 18,
    color: '#F44336',
    textAlign: 'center',
    marginBottom: 10,
  },
  errorSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  permissionButton: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#4CAF50',
    borderRadius: 25,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});

