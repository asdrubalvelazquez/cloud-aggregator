"""
Utilidades para autenticación y validación de JWT de Supabase
"""
import os
import jwt
from typing import Optional
from fastapi import Header, HTTPException

# Secret para firmar el state JWT (debe ser el mismo que SUPABASE_JWT_SECRET)
JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "your-super-secret-jwt-key")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", JWT_SECRET)


def create_state_token(user_id: str) -> str:
    """Crea un JWT firmado con el user_id para usar como state en OAuth"""
    payload = {"user_id": user_id, "type": "oauth_state"}
    token = jwt.encode(payload, JWT_SECRET, algorithm="HS256")
    return token


def decode_state_token(state: str) -> Optional[str]:
    """Decodifica el state JWT y retorna el user_id"""
    try:
        payload = jwt.decode(state, JWT_SECRET, algorithms=["HS256"])
        if payload.get("type") != "oauth_state":
            return None
        return payload.get("user_id")
    except jwt.InvalidTokenError:
        return None


def verify_supabase_jwt(authorization: Optional[str] = Header(None)) -> str:
    """
    Verifica el JWT de Supabase del header Authorization.
    Retorna el user_id si es válido, sino lanza HTTPException.
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    
    try:
        # El header viene como "Bearer <token>"
        scheme, token = authorization.split()
        if scheme.lower() != "bearer":
            raise HTTPException(status_code=401, detail="Invalid authentication scheme")
        
        # Decodificar el JWT de Supabase
        payload = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
        
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token: missing sub")
        
        return user_id
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid authorization header format")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
