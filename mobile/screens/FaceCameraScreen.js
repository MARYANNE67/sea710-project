/**
 * Face Camera Screen with AR Mesh Overlay
 * Front-facing camera interface that detects face mesh landmarks using MediaPipe
 * and renders product-specific AR overlays (lipstick, eyeshadow, foundation, etc.)
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
import Svg, { Polygon, Path } from 'react-native-svg';
import { detectFaceMesh } from '../services/api';
import { AppConfig, FeatureFlags } from '../config/featureFlags';
import { renderDefaultMesh, renderClassBasedMesh, getFacialRegions } from '../utils/meshOverlays';

const API_BASE_URL = __DEV__
  ? AppConfig.API_BASE_URL_DEV
  : AppConfig.API_BASE_URL_PROD;

const FACE_DETECTION_INTERVAL = 1000; // Run face detection every 1 second for better accuracy

export default function FaceCameraScreen({ route, navigation }) {
  const { productType, productName, productImageUrl } = route.params || {};
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraType] = useState('front'); // Front camera for face
  const [faceMeshData, setFaceMeshData] = useState(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const isDetectingRef = useRef(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [photoDimensions, setPhotoDimensions] = useState(null);
  const [cameraViewDimensions, setCameraViewDimensions] = useState(null);
  const cameraRef = useRef(null);
  const detectionIntervalRef = useRef(null);
  const lastMeshDataRef = useRef(null); // Track last rendered mesh data to prevent unnecessary re-renders
  const persistentMeshDataRef = useRef(null); // Keep last valid mesh data to prevent blinking

  // Use focus effect to start/stop face detection when screen is focused
  useFocusEffect(
    React.useCallback(() => {
      console.log('[Face Detection] Screen focused - starting face detection');
      
      // Start continuous face detection only if feature flag is enabled
      if (FeatureFlags.ENABLE_FACE_MESH) {
        startFaceDetection();
      }

      // Cleanup when screen loses focus
      return () => {
        console.log('[Face Detection] Screen blurred - stopping face detection');
        if (detectionIntervalRef.current) {
          clearInterval(detectionIntervalRef.current);
          detectionIntervalRef.current = null;
        }
        // Clear face mesh data when leaving screen
        setFaceMeshData(null);
        setFaceDetected(false);
      };
    }, [])
  );

  const startFaceDetection = () => {
    if (!FeatureFlags.ENABLE_FACE_MESH) return;

    detectionIntervalRef.current = setInterval(() => {
      if (!isDetectingRef.current && cameraRef.current) {
        detectFace();
      }
    }, FACE_DETECTION_INTERVAL);
  };

  const detectFace = async () => {
    if (!cameraRef.current || isDetecting || !FeatureFlags.ENABLE_FACE_MESH) {
      console.log('[Face Detection] Skipping - cameraRef:', !!cameraRef.current, 'isDetecting:', isDetecting, 'flag:', FeatureFlags.ENABLE_FACE_MESH);
      return;
    }

    setIsDetecting(true);
    isDetectingRef.current = true;
    try {
      console.log('[Face Detection] Capturing photo...');
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        base64: false,
        skipProcessing: true, // Use skipProcessing for faster capture
      });

      if (!photo || !photo.uri) {
        console.error('[Face Detection] Failed to capture photo');
        return;
      }

      // Store photo dimensions for coordinate scaling
      if (photo.width && photo.height) {
        setPhotoDimensions({ width: photo.width, height: photo.height });
      }

      console.log('[Face Detection] Calling API with photo URI:', photo.uri.substring(0, 50));
      const result = await detectFaceMesh(API_BASE_URL, photo.uri, false);

      // Handle both success and error responses gracefully
      if (result.status === 'error') {
        // API returned an error response (not a thrown error)
        console.log('[Face Detection] API returned error:', result.message);
        // Don't clear mesh data - keep last known position to prevent blinking
        // Only update detection status
        setFaceDetected(false);
        return;
      }

      console.log('[Face Detection] Result:', {
        status: result.status,
        face_detected: result.face_detected,
        num_landmarks: result.num_landmarks,
        has_landmarks: !!result.landmarks,
        landmarks_count: result.landmarks?.length,
        bbox: result.bbox,
        image_dimensions: result.image_dimensions,
        photo_dimensions: { width: photo.width, height: photo.height },
      });

      if (result.status === 'success') {
        if (result.face_detected && result.landmarks && result.landmarks.length > 0) {
          // Use image dimensions from API response if available, otherwise use photo dimensions
          const imgDims = result.image_dimensions || { width: photo.width, height: photo.height };
          setPhotoDimensions(imgDims);
          
          // Update mesh data - this will replace the previous mesh smoothly
          setFaceMeshData(result);
          persistentMeshDataRef.current = result; // Store for persistence
          setFaceDetected(true);
        } else {
          // Face not detected - keep last mesh data to prevent blinking
          // Only update the detection status, don't clear mesh
          setFaceDetected(false);
          // Keep using persistentMeshDataRef.current for rendering
        }
      } else {
        // Handle any other status - keep last mesh
        setFaceDetected(false);
      }
    } catch (error) {
      // Silently handle any unexpected errors - don't show popups
      // This should rarely happen now since detectFaceMesh doesn't throw
      console.log('[Face Detection] Unexpected error (handled silently):', error.message);
      setFaceMeshData(null);
      setFaceDetected(false);
    } finally {
      setIsDetecting(false);
      isDetectingRef.current = false;
    }
  };

  const renderFaceMesh = () => {
    // Use persistent mesh data if current data is not available (prevents blinking)
    const meshDataToUse = faceMeshData || persistentMeshDataRef.current;
    
    if (!meshDataToUse || !meshDataToUse.landmarks) {
      // No mesh data available at all
      return null;
    }

    // Check if mesh data has actually changed to prevent unnecessary re-renders
    const dataKey = `${meshDataToUse.landmarks?.length || 0}-${meshDataToUse.bbox?.x || 0}-${meshDataToUse.bbox?.y || 0}`;
    if (lastMeshDataRef.current === dataKey) {
      // Data hasn't changed, skip re-render but still return the mesh
      // This allows the mesh to persist even when detection temporarily fails
    } else {
      lastMeshDataRef.current = dataKey;
    }

    const { landmarks, bbox } = meshDataToUse;
    
    // Use camera view dimensions if available, otherwise fall back to window dimensions
    const viewDims = cameraViewDimensions || Dimensions.get('window');
    const viewWidth = viewDims.width;
    const viewHeight = viewDims.height;

    // Get image dimensions from API response or photo dimensions
    const imgDims = meshDataToUse.image_dimensions || photoDimensions;
    
    if (!imgDims) {
      console.warn('[Face Mesh] No image dimensions available, using fallback scaling');
      return null;
    }

    const imgWidth = imgDims.width;
    const imgHeight = imgDims.height;

    // Calculate scaling factors
    // Camera preview typically fills the view, so we scale from image coords to view coords
    const imgAspectRatio = imgWidth / imgHeight;
    const viewAspectRatio = viewWidth / viewHeight;

    let scaleX, scaleY, offsetX = 0, offsetY = 0;

    // For front-facing camera, the preview is typically mirrored, but the photo is not
    // So we need to flip X coordinates horizontally
    const isFrontCamera = cameraType === 'front';
    const mirrorX = isFrontCamera;

    // Use the same scaling approach as camera preview
    // The camera preview fills the view, so we need to match that scaling
    if (viewAspectRatio > imgAspectRatio) {
      // View is wider than image - image will be letterboxed (black bars on sides)
      // Scale based on height to fill view height
      scaleY = viewHeight / imgHeight;
      scaleX = scaleY; // Maintain aspect ratio
      offsetX = (viewWidth - imgWidth * scaleX) / 2;
    } else {
      // View is taller than image - image will be pillarboxed (black bars on top/bottom)
      // Scale based on width to fill view width
      scaleX = viewWidth / imgWidth;
      scaleY = scaleX; // Maintain aspect ratio
      offsetY = (viewHeight - imgHeight * scaleY) / 2;
    }

    console.log('[Face Mesh] Scaling params:', {
      imgSize: { width: imgWidth, height: imgHeight },
      viewSize: { width: viewWidth, height: viewHeight },
      scale: { scaleX, scaleY },
      offset: { offsetX, offsetY },
      mirrorX,
      imgAspectRatio: imgAspectRatio.toFixed(3),
      viewAspectRatio: viewAspectRatio.toFixed(3),
    });

    // Prepare scaling parameters for mesh overlay functions
    const scalingParams = {
      landmarks,
      viewWidth,
      viewHeight,
      scaleX,
      scaleY,
      offsetX,
      offsetY,
      mirrorX,
    };

    // Determine which mesh to render based on feature flag
    let meshPoints = [];
    
    if (FeatureFlags.ENABLE_DEFAULT_FACE_MESH) {
      // Render default mesh (all landmarks)
      meshPoints = renderDefaultMesh(landmarks, scalingParams);
    } else {
      // Render class-based mesh overlay
      meshPoints = renderClassBasedMesh(productType, meshDataToUse, scalingParams);
    }

    // Only log when mesh points change significantly
    if (meshPoints && meshPoints.length > 0) {
      console.log('[Face Mesh] Rendered:', {
        productType,
        landmarksCount: landmarks.length,
        meshPointsCount: meshPoints.length,
        hasFacialRegions: !!getFacialRegions(faceMeshData),
      });
    }

    if (!meshPoints || meshPoints.length === 0) {
      return null;
    }

    // Check if we're using new shape-based rendering (polygons) or old point-based (dots)
    const isShapeBased = meshPoints.length > 0 && meshPoints[0].type === 'polygon';

    if (isShapeBased) {
      // Render as semi-transparent filled shapes
      return (
        <View style={styles.meshOverlay} pointerEvents="none">
          <Svg style={StyleSheet.absoluteFill} width={viewWidth} height={viewHeight}>
            {meshPoints.map((shape) => {
              if (shape.type === 'polygon' && shape.points && shape.points.length >= 3) {
                // Create a closed path string for proper outline
                const pathData = shape.points
                  .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
                  .join(' ') + ' Z'; // Close the path
                
                // Use Path instead of Polygon for better control
                return (
                  <Path
                    key={shape.key}
                    d={pathData}
                    fill={shape.color || '#FF1493'}
                    fillOpacity={shape.opacity || 0.4}
                    stroke={shape.color || '#FF1493'}
                    strokeWidth={2}
                    strokeOpacity={0.6}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                );
              }
              return null;
            })}
          </Svg>
        </View>
      );
    } else {
      // Fallback to old point-based rendering for default mesh
      return (
        <View style={styles.meshOverlay}>
          {meshPoints.map((point) => {
            // Get style based on point type
            const pointStyle = getPointStyle(point.type);
            
            return (
              <View
                key={point.key}
                style={[
                  pointStyle,
                  {
                    left: point.x,
                    top: point.y,
                    width: point.size || 3,
                    height: point.size || 3,
                    borderRadius: (point.size || 3) / 2,
                  },
                ]}
              />
            );
          })}
        </View>
      );
    }
  };

  /**
   * Get style for different mesh point types
   */
  const getPointStyle = (pointType) => {
    switch (pointType) {
      case 'lip':
        return styles.lipPoint;
      case 'eye':
        return styles.eyePoint;
      case 'face':
        return styles.facePoint;
      case 'landmark':
      default:
        return styles.landmarkPoint;
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
      
      {/* Camera View */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={cameraType}
        ratio="16:9"
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setCameraViewDimensions({ width, height });
          console.log('[Camera] View dimensions:', { width, height });
        }}
      >
        <View style={styles.cameraOverlay}>
          {/* Product Info Overlay */}
          <View style={styles.productInfoOverlay}>
            <Text style={styles.productName} numberOfLines={1}>
              {productName || productType || 'Virtual Try-On'}
            </Text>
            <Text style={styles.instructionText}>
              {FeatureFlags.ENABLE_FACE_MESH
                ? (faceDetected ? 'Face detected!' : 'Position your face in the frame')
                : 'Face mesh detection disabled'}
            </Text>
            {isDetecting && FeatureFlags.ENABLE_FACE_MESH && (
              <ActivityIndicator size="small" color="#fff" style={{ marginTop: 8 }} />
            )}
          </View>

          {/* Face Mesh Overlay - Only show if feature flag is enabled */}
          {FeatureFlags.ENABLE_FACE_MESH && renderFaceMesh()}

          {/* Status Indicator */}
          {FeatureFlags.ENABLE_FACE_MESH && !faceDetected && !isDetecting && (
            <View style={styles.statusOverlay}>
              <Text style={styles.statusText}>
                Waiting for face detection...
              </Text>
            </View>
          )}
        </View>
      </CameraView>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>

        {/* Placeholder for capture/save button */}
        <TouchableOpacity
          style={styles.captureButton}
          onPress={() => {
            // TODO: Implement capture/save functionality
            console.log('Capture virtual try-on');
          }}
        >
          <View style={styles.captureButtonInner} />
        </TouchableOpacity>

        {/* Placeholder for settings/adjustments button */}
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => {
            // TODO: Implement settings/adjustments
            console.log('Open settings');
          }}
        >
          <Text style={styles.settingsButtonText}>Settings</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  productInfoOverlay: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  productName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    marginBottom: 10,
  },
  instructionText: {
    color: '#fff',
    fontSize: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 15,
  },
  arPlaceholder: {
    position: 'absolute',
    bottom: 120,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  arPlaceholderText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    marginBottom: 8,
  },
  arPlaceholderSubtext: {
    color: '#fff',
    fontSize: 13,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 15,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  backButton: {
    padding: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    minWidth: 80,
    alignItems: 'center',
  },
  backButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  captureButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#333',
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fff',
  },
  settingsButton: {
    padding: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    minWidth: 80,
    alignItems: 'center',
  },
  settingsButtonText: {
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
  meshOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
  faceBoundingBox: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: '#00FF00',
    backgroundColor: 'transparent',
    borderRadius: 2,
  },
  landmarkPoint: {
    position: 'absolute',
    backgroundColor: '#00FF00',
    borderWidth: 0.5,
    borderColor: '#000000',
  },
  // Class-based mesh point styles
  lipPoint: {
    position: 'absolute',
    backgroundColor: '#FF1493', // Deep pink for lips
    borderWidth: 0.5,
    borderColor: '#FFFFFF',
  },
  eyePoint: {
    position: 'absolute',
    backgroundColor: '#0000FF', // Blue for eyes
    borderWidth: 0.5,
    borderColor: '#FFFFFF',
  },
  facePoint: {
    position: 'absolute',
    backgroundColor: '#FFD700', // Gold for face
    borderWidth: 0.5,
    borderColor: '#000000',
  },
  statusOverlay: {
    position: 'absolute',
    bottom: 120,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  statusText: {
    color: '#fff',
    fontSize: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 15,
  },
});

