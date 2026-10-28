"""
Serviço de Reconhecimento Facial de Alta Segurança (Deep Learning / Redes Neurais)

Utiliza os modelos neurais do OpenCV Zoo:
1. YuNet: Detecção facial precisa com localização de 5 marcos biométricos.
2. SFace: Rede Neural de Reconhecimento Facial (Embeddings de 128 dimensões).
Possui download automático dos modelos caso não existam no servidor de deploy (Render/Railway).
"""
import base64
import json
import io
import os
import urllib.request
import logging
import numpy as np
import cv2
from PIL import Image

logger = logging.getLogger(__name__)

DIR_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR_MODELOS = os.path.join(DIR_BASE, "modelos")
CAMINHO_YUNET = os.path.join(DIR_MODELOS, "face_detection_yunet.onnx")
CAMINHO_SFACE = os.path.join(DIR_MODELOS, "face_recognition_sface.onnx")

URL_YUNET = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
URL_SFACE = "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"

_detector = None
_reconhecedor = None

def garantir_modelos():
    """Baixa os modelos ONNX automaticamente se não existirem no servidor em nuvem."""
    os.makedirs(DIR_MODELOS, exist_ok=True)
    if not os.path.exists(CAMINHO_YUNET):
        logger.info("Baixando YuNet ONNX...")
        urllib.request.urlretrieve(URL_YUNET, CAMINHO_YUNET)
    if not os.path.exists(CAMINHO_SFACE):
        logger.info("Baixando SFace ONNX...")
        urllib.request.urlretrieve(URL_SFACE, CAMINHO_SFACE)

def obter_modelos():
    """Inicializa os modelos de rede neural sob demanda."""
    global _detector, _reconhecedor
    if _reconhecedor is None:
        garantir_modelos()
        
        _detector = cv2.FaceDetectorYN_create(
            CAMINHO_YUNET,
            "",
            (320, 320),
            score_threshold=0.8,
            nms_threshold=0.3,
            top_k=5000
        )
        _reconhecedor = cv2.FaceRecognizerSF_create(CAMINHO_SFACE, "")
        logger.info("✅ Modelos Deep Learning (YuNet + SFace) carregados com sucesso.")
    return _detector, _reconhecedor


def base64_para_imagem_bgr(imagem_base64: str) -> np.ndarray:
    if "," in imagem_base64:
        imagem_base64 = imagem_base64.split(",")[1]
    dados = base64.b64decode(imagem_base64)
    img_pil = Image.open(io.BytesIO(dados)).convert("RGB")
    img_rgb = np.array(img_pil)
    return cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)


def extrair_face_e_feature(img_bgr: np.ndarray):
    detector, reconhecedor = obter_modelos()
    h, w, _ = img_bgr.shape
    detector.setInputSize((w, h))

    _, faces = detector.detect(img_bgr)

    if faces is None or len(faces) == 0:
        raise ValueError("Nenhum rosto detectado com clareza. Posicione-se em frente à câmera com boa iluminação.")

    if len(faces) > 1:
        raise ValueError("Mais de um rosto detectado. Apenas o funcionário deve estar no enquadramento.")

    face = faces[0]
    confianca_deteccao = face[-1]
    if confianca_deteccao < 0.75:
        raise ValueError("Confiança visual insuficiente. Mantenha o rosto fixo e retire acessórios obstrutivos.")

    face_alinhada = reconhecedor.alignCrop(img_bgr, face)
    feature = reconhecedor.feature(face_alinhada)
    return feature


def gerar_encoding(imagem_base64: str) -> list:
    img_bgr = base64_para_imagem_bgr(imagem_base64)
    feature = extrair_face_e_feature(img_bgr)
    return feature.flatten().tolist()


def verificar_face(imagem_base64: str, funcionarios: list) -> dict:
    try:
        img_bgr = base64_para_imagem_bgr(imagem_base64)
        feature_capturada = extrair_face_e_feature(img_bgr)
    except ValueError as e:
        return {"erro": str(e)}
    except Exception as e:
        logger.error(f"Erro no processamento neural: {e}")
        return {"erro": f"Erro de processamento da imagem: {str(e)}"}

    _, reconhecedor = obter_modelos()

    melhor_funcionario = None
    maior_similaridade = -1.0
    LIMIAR_MINIMO_SIMILARIDADE = 0.35

    for func in funcionarios:
        if not func.get("encoding_facial"):
            continue
        try:
            vetor_cadastrado = np.array(json.loads(func["encoding_facial"]), dtype=np.float32).reshape(1, -1)
            score = reconhecedor.match(feature_capturada, vetor_cadastrado, cv2.FaceRecognizerSF_FR_COSINE)

            if score > maior_similaridade:
                maior_similaridade = score
                melhor_funcionario = func
        except Exception as err:
            logger.warning(f"Erro comparando com func {func.get('id')}: {err}")
            continue

    if melhor_funcionario and maior_similaridade >= LIMIAR_MINIMO_SIMILARIDADE:
        confianca_perc = min(99.9, max(80.0, ((maior_similaridade - 0.20) / 0.50) * 100))
        return {
            "funcionario_id": melhor_funcionario["id"],
            "funcionario_nome": melhor_funcionario["nome"],
            "confianca": round(confianca_perc, 1),
            "score_cosseno": float(maior_similaridade)
        }

    return {
        "erro": "Identidade biométrica não reconhecida. Certifique-se de que é um funcionário cadastrado."
    }
