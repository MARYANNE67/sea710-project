"""
FastAPI Backend for Makeup Product Detection
Handles image uploads and YOLO model inference
"""
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from ultralytics import YOLO
import cv2
import numpy as np
from PIL import Image
import io
from typing import Optional
import os
from pathlib import Path
from src.api.product_classes import normalize_class_name, ProductClass, get_display_name

# Import face mesh detector (optional - only if MediaPipe is installed)
try:
    from src.api.face_mesh import get_face_mesh_detector
    FACE_MESH_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Face mesh not available. MediaPipe may not be installed: {e}")
    FACE_MESH_AVAILABLE = False
    def get_face_mesh_detector():
        raise ImportError("MediaPipe is not installed. Run: pip install mediapipe")

# Global model variable
model: Optional[YOLO] = None
model_path: Optional[str] = None
confidence_threshold: float = 0.25


def load_model(path: str):
    """Load YOLO model from .pt file"""
    global model, model_path
    try:
        if not os.path.exists(path):
            raise FileNotFoundError(f"Model file not found: {path}")
        
        model = YOLO(path)
        model_path = path
        print(f"Model loaded successfully: {path}")
        return True
    except Exception as e:
        print(f"Error loading model: {str(e)}")
        raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan event handler for startup and shutdown"""
    # Startup
    print("Starting up API server...")
    # Try absolute path first, then fallback to relative path
    absolute_model_path = r"C:\Users\itsme\OneDrive\Desktop\School Things\SWE Year 4\SEA710\sea710-project\models\final\best.pt"
    relative_model_path = "models/final/best.pt"
    
    # Determine which path to use
    if os.path.exists(absolute_model_path):
        default_model_path = absolute_model_path
    elif os.path.exists(relative_model_path):
        default_model_path = relative_model_path
    else:
        print("Warning: Default model file not found at either absolute or relative path")
        default_model_path = None
    
    if default_model_path:
        try:
            load_model(default_model_path)
        except Exception as e:
            print(f"Could not load default model: {str(e)}")
    
    yield
    
    # Shutdown
    print("Shutting down API server...")


app = FastAPI(
    title="Makeup Product Detection API",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for mobile app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your mobile app's origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "running",
        "model_loaded": model is not None,
        "model_path": model_path
    }


@app.get("/health")
async def health():
    """Health check with model status"""
    return {
        "status": "healthy",
        "model_loaded": model is not None,
        "model_path": model_path,
        "confidence_threshold": confidence_threshold
    }


@app.post("/load-model")
async def load_model_endpoint(data: dict):
    """Load a YOLO model from a file path"""
    try:
        model_file = data.get("model_file")
        if not model_file:
            raise HTTPException(status_code=400, detail="model_file is required")
        
        load_model(model_file)
        return {
            "status": "success",
            "message": f"Model loaded: {model_file}",
            "model_path": model_path
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/detect")
async def detect_products(
    image: UploadFile = File(...),
    confidence: Optional[float] = None
):
    """
    Detect makeup products in uploaded image
    
    Args:
        image: Image file (JPEG, PNG, etc.)
        confidence: Confidence threshold (0.0-1.0), defaults to global threshold
    
    Returns:
        JSON with detections including bounding boxes, classes, and confidence scores
    """
    if model is None:
        raise HTTPException(
            status_code=503,
            detail="Model not loaded. Please load a model first using /load-model"
        )
    
    try:
        # Read image file
        image_bytes = await image.read()
        
        if not image_bytes or len(image_bytes) == 0:
            raise HTTPException(status_code=400, detail="Empty image file received")
        
        print(f"[API] Received image: {len(image_bytes)} bytes, content_type: {image.content_type}")
        
        # Convert bytes to numpy array
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            print(f"[API] Failed to decode image. First 20 bytes: {image_bytes[:20]}")
            raise HTTPException(status_code=400, detail="Invalid image format - could not decode image")
        
        print(f"[API] Image decoded successfully: shape={img.shape}")
        
        # Use provided confidence or default
        conf_threshold = confidence if confidence is not None else confidence_threshold
        
        print(f"[API] Running YOLO inference with confidence threshold: {conf_threshold}")
        
        # Run YOLO inference
        results = model(img, conf=conf_threshold, verbose=False)
        
        print(f"[API] YOLO inference completed")
        
        # Parse results
        detections = []
        for result in results:
            boxes = result.boxes
            for box in boxes:
                # Get box coordinates
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                
                # Get class and confidence
                conf = float(box.conf[0].cpu().numpy())
                class_id = int(box.cls[0].cpu().numpy())
                raw_class_name = result.names[class_id] if hasattr(result, 'names') else f"Class {class_id}"
                
                # Normalize class name to ProductClass enum
                normalized_class = normalize_class_name(raw_class_name)
                class_name = normalized_class.value if normalized_class else raw_class_name
                display_name = get_display_name(normalized_class) if normalized_class else raw_class_name
                
                detections.append({
                    "class_id": class_id,
                    "class_name": class_name,  # Normalized enum value
                    "display_name": display_name,  # Human-readable name
                    "raw_class_name": raw_class_name,  # Original from model
                    "confidence": round(conf, 4),
                    "bbox": {
                        "x1": float(x1),
                        "y1": float(y1),
                        "x2": float(x2),
                        "y2": float(y2)
                    }
                })
        
        print(f"[API] Returning {len(detections)} detections")
        
        return {
            "status": "success",
            "detections": detections,
            "count": len(detections),
            "image_shape": {
                "height": int(img.shape[0]),
                "width": int(img.shape[1])
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[API] Detection error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Detection error: {str(e)}")


@app.post("/detect-with-image")
async def detect_with_annotated_image(
    image: UploadFile = File(...),
    confidence: Optional[float] = None
):
    """
    Detect products and return annotated image with bounding boxes
    
    Returns base64-encoded annotated image
    """
    if model is None:
        raise HTTPException(
            status_code=503,
            detail="Model not loaded. Please load a model first"
        )
    
    try:
        # Read and process image
        image_bytes = await image.read()
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            raise HTTPException(status_code=400, detail="Invalid image format")
        
        conf_threshold = confidence if confidence is not None else confidence_threshold
        
        # Run inference
        results = model(img, conf=conf_threshold, verbose=False)
        
        # Draw detections on image
        annotated_img = img.copy()
        detections = []
        
        for result in results:
            boxes = result.boxes
            for box in boxes:
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
                
                conf = float(box.conf[0].cpu().numpy())
                class_id = int(box.cls[0].cpu().numpy())
                raw_class_name = result.names[class_id] if hasattr(result, 'names') else f"Class {class_id}"
                
                # Normalize class name to ProductClass enum
                normalized_class = normalize_class_name(raw_class_name)
                class_name = normalized_class.value if normalized_class else raw_class_name
                display_name = get_display_name(normalized_class) if normalized_class else raw_class_name
                
                if conf >= conf_threshold:
                    # Draw bounding box
                    cv2.rectangle(annotated_img, (x1, y1), (x2, y2), (0, 255, 0), 2)
                    
                    # Draw label using display name
                    label = f"{display_name}: {conf:.2f}"
                    (text_width, text_height), baseline = cv2.getTextSize(
                        label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1
                    )
                    cv2.rectangle(annotated_img, (x1, y1 - text_height - 10),
                                (x1 + text_width, y1), (0, 255, 0), -1)
                    cv2.putText(annotated_img, label, (x1, y1 - 5),
                              cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)
                    
                    detections.append({
                        "class_id": class_id,
                        "class_name": class_name,  # Normalized enum value
                        "display_name": display_name,  # Human-readable name
                        "raw_class_name": raw_class_name,  # Original from model
                        "confidence": round(conf, 4),
                        "bbox": {
                            "x1": float(x1),
                            "y1": float(y1),
                            "x2": float(x2),
                            "y2": float(y2)
                        }
                    })
        
        # Encode annotated image to base64
        _, buffer = cv2.imencode('.jpg', annotated_img)
        import base64
        img_base64 = base64.b64encode(buffer).decode('utf-8')
        
        return {
            "status": "success",
            "detections": detections,
            "count": len(detections),
            "annotated_image": f"data:image/jpeg;base64,{img_base64}"
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")


@app.post("/set-confidence")
async def set_confidence(data: dict):
    """Set global confidence threshold"""
    global confidence_threshold
    threshold = data.get("threshold")
    if threshold is None:
        raise HTTPException(status_code=400, detail="threshold is required")
    if not 0.0 <= threshold <= 1.0:
        raise HTTPException(status_code=400, detail="Confidence must be between 0.0 and 1.0")
    
    confidence_threshold = threshold
    return {
        "status": "success",
        "confidence_threshold": confidence_threshold
    }


@app.post("/detect-face-mesh")
async def detect_face_mesh(
    image: UploadFile = File(...),
    draw_mesh: bool = False
):
    """
    Detect face mesh landmarks using MediaPipe Face Mesh
    
    Args:
        image: Image file (JPEG, PNG, etc.)
        draw_mesh: If True, return annotated image with mesh drawn
    
    Returns:
        JSON with face mesh landmarks and optionally annotated image
    """
    if not FACE_MESH_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="Face mesh detection is not available. Please install MediaPipe: pip install mediapipe"
        )
    
    try:
        # Read image file
        image_bytes = await image.read()
        
        # Convert bytes to numpy array
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            raise HTTPException(status_code=400, detail="Invalid image format")
        
        # Get face mesh detector
        detector = get_face_mesh_detector()
        
        # Detect face mesh
        face_data = detector.detect_face_mesh(img)
        
        # Get image dimensions for coordinate scaling on frontend
        img_height, img_width = img.shape[:2]

        if face_data is None:
            print("[API] No face detected in image")
            return {
                "status": "success",
                "face_detected": False,
                "message": "No face detected in image",
                "landmarks": [],
                "num_landmarks": 0,
                "bbox": None,
                "image_dimensions": {
                    "width": int(img_width),
                    "height": int(img_height)
                },
                "facial_regions": None
            }

        # Get facial regions
        facial_regions = detector.get_facial_regions(face_data)
        
        response = {
            "status": "success",
            "face_detected": True,
            "landmarks": face_data["landmarks"],
            "bbox": face_data["bbox"],
            "num_landmarks": face_data["num_landmarks"],
            "image_dimensions": {
                "width": int(img_width),
                "height": int(img_height)
            },
            "facial_regions": {
                "outer_lip": facial_regions.get("outer_lip", []),
                "upper_lip": facial_regions["upper_lip"],
                "lower_lip": facial_regions["lower_lip"],
                "left_eye": facial_regions["left_eye"],
                "right_eye": facial_regions["right_eye"],
                "face_oval": facial_regions["face_oval"],
                "left_under_eye": facial_regions.get("left_under_eye", []),
                "right_under_eye": facial_regions.get("right_under_eye", []),
                "around_mouth": facial_regions.get("around_mouth", []),
                "left_eyeshadow": facial_regions.get("left_eyeshadow", []),
                "right_eyeshadow": facial_regions.get("right_eyeshadow", []),
            }
        }
        
        # Optionally draw mesh on image and return
        if draw_mesh:
            annotated_img = detector.draw_face_mesh(img, face_data)
            _, buffer = cv2.imencode('.jpg', annotated_img)
            import base64
            img_base64 = base64.b64encode(buffer).decode('utf-8')
            response["annotated_image"] = f"data:image/jpeg;base64,{img_base64}"
        
        return response
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Face mesh detection error: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

