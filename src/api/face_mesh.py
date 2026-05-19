"""
MediaPipe Face Mesh Detection
Uses the MediaPipe Tasks API (required for mediapipe 0.10+)
"""
import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from typing import Optional
import urllib.request
from pathlib import Path

MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
MODEL_PATH = Path(__file__).parent.parent.parent / "models" / "face_landmarker.task"


def _ensure_model():
    if not MODEL_PATH.exists():
        MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
        print("Downloading face landmarker model (~29MB)...")
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
        print(f"Model saved to {MODEL_PATH}")


class FaceMeshDetector:
    def __init__(self):
        _ensure_model()
        base_options = python.BaseOptions(model_asset_path=str(MODEL_PATH))
        options = vision.FaceLandmarkerOptions(
            base_options=base_options,
            num_faces=1,
            min_face_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self._detector = vision.FaceLandmarker.create_from_options(options)

    def detect_face_mesh(self, image: np.ndarray) -> Optional[dict]:
        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_image)
        result = self._detector.detect(mp_image)

        if not result.face_landmarks:
            return None

        h, w = image.shape[:2]
        landmarks = [
            {"x": float(lm.x * w), "y": float(lm.y * h), "z": float(lm.z * w)}
            for lm in result.face_landmarks[0]
        ]

        x_coords = [lm["x"] for lm in landmarks]
        y_coords = [lm["y"] for lm in landmarks]

        return {
            "landmarks": landmarks,
            "bbox": {
                "x": float(min(x_coords)),
                "y": float(min(y_coords)),
                "width": float(max(x_coords) - min(x_coords)),
                "height": float(max(y_coords) - min(y_coords)),
            },
            "num_landmarks": len(landmarks),
        }

    def draw_face_mesh(self, image: np.ndarray, face_data: dict) -> np.ndarray:
        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        annotated = rgb_image.copy()

        for lm in face_data["landmarks"]:
            cv2.circle(annotated, (int(lm["x"]), int(lm["y"])), 2, (0, 255, 0), -1)

        bbox = face_data["bbox"]
        cv2.rectangle(
            annotated,
            (int(bbox["x"]), int(bbox["y"])),
            (int(bbox["x"] + bbox["width"]), int(bbox["y"] + bbox["height"])),
            (0, 255, 0),
            2,
        )

        return cv2.cvtColor(annotated, cv2.COLOR_RGB2BGR)

    def get_facial_regions(self, face_data: dict) -> dict:
        landmarks = face_data["landmarks"]

        outer_lip_indices = [61, 84, 17, 314, 405, 320, 307, 375, 321, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78]
        inner_lip_indices = [78, 81, 80, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]
        left_eye_indices = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
        right_eye_indices = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466]
        left_eyeshadow_indices = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46, 124, 35, 31, 228, 229, 230, 231, 232, 233, 244, 245, 122, 6, 197, 196, 3, 51, 48, 115, 131, 134, 102, 49, 220, 305, 281, 363, 360]
        right_eyeshadow_indices = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276, 353, 265, 261, 447, 448, 449, 450, 451, 452, 453, 464, 351, 326, 425, 427, 411, 280, 278, 344, 340, 346, 347, 330, 279, 358, 360, 440, 344]
        face_oval_indices = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
        left_under_eye_indices = [23, 24, 25, 110, 226, 31, 228, 229, 230, 231, 232, 233]
        right_under_eye_indices = [253, 254, 255, 339, 446, 260, 447, 448, 449, 450, 451, 452]
        around_mouth_indices = [0, 11, 12, 13, 14, 15, 16, 17, 18, 200, 269, 270, 271, 272, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78]

        def get_landmarks(indices):
            return [landmarks[i] for i in indices if 0 <= i < len(landmarks)]

        return {
            "outer_lip": get_landmarks(outer_lip_indices),
            "inner_lip": get_landmarks(inner_lip_indices),
            "upper_lip": get_landmarks(outer_lip_indices[:10]),
            "lower_lip": get_landmarks(outer_lip_indices[10:]),
            "left_eye": get_landmarks(left_eye_indices),
            "right_eye": get_landmarks(right_eye_indices),
            "face_oval": get_landmarks(face_oval_indices),
            "left_under_eye": get_landmarks(left_under_eye_indices),
            "right_under_eye": get_landmarks(right_under_eye_indices),
            "around_mouth": get_landmarks(around_mouth_indices),
            "left_eyeshadow": get_landmarks(left_eyeshadow_indices),
            "right_eyeshadow": get_landmarks(right_eyeshadow_indices),
        }


face_mesh_detector: Optional[FaceMeshDetector] = None


def get_face_mesh_detector() -> FaceMeshDetector:
    global face_mesh_detector
    if face_mesh_detector is None:
        face_mesh_detector = FaceMeshDetector()
    return face_mesh_detector
