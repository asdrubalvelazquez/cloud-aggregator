"""
Token encryption utilities for OAuth tokens.

Uses Fernet (symmetric encryption) with AES-128 CBC + HMAC-SHA256.
Encryption key must be set in OAUTH_TOKEN_ENCRYPTION_KEY environment variable.

Security Features:
- Symmetric encryption (single key for encrypt/decrypt)
- Key stored in ENV (never in code)
- Backward compatible (handles plaintext tokens gracefully)
- Fast performance (~1ms overhead per operation)
"""
import os
import logging
from typing import Optional
from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)


def _get_cipher() -> Fernet:
    """
    Get Fernet cipher instance with key from environment.
    
    Raises:
        ValueError: If OAUTH_TOKEN_ENCRYPTION_KEY is not set
    """
    key = os.getenv("OAUTH_TOKEN_ENCRYPTION_KEY")
    if not key:
        raise ValueError(
            "OAUTH_TOKEN_ENCRYPTION_KEY not set in environment. "
            "Generate with: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
        )
    return Fernet(key.encode())


def encrypt_token(plaintext: Optional[str]) -> Optional[str]:
    """
    Encrypt OAuth token for secure storage.
    
    Args:
        plaintext: Token string to encrypt (or None)
    
    Returns:
        Base64-encoded ciphertext string (or None if input was None)
    
    Example:
        >>> encrypt_token("ya29.a0AfH6...")
        'gAAAAABhk...'
    """
    if not plaintext or not plaintext.strip():
        return plaintext
    
    try:
        cipher = _get_cipher()
        encrypted = cipher.encrypt(plaintext.encode())
        return encrypted.decode()  # Store as string in DB
    except Exception as e:
        logger.error(f"[CRYPTO ERROR] Failed to encrypt token: {str(e)}")
        raise


def decrypt_token(ciphertext: Optional[str]) -> Optional[str]:
    """
    Decrypt OAuth token from storage.
    
    Args:
        ciphertext: Encrypted token string (or None)
    
    Returns:
        Plaintext token string (or None if input was None)
    
    Backward Compatibility:
        If decryption fails (e.g., token is plaintext from before encryption),
        returns the input unchanged. This allows gradual migration.
    
    Example:
        >>> decrypt_token('gAAAAABhk...')
        'ya29.a0AfH6...'
    """
    if not ciphertext or not ciphertext.strip():
        return ciphertext
    
    try:
        cipher = _get_cipher()
        decrypted = cipher.decrypt(ciphertext.encode())
        return decrypted.decode()
    except InvalidToken:
        # BACKWARD COMPATIBILITY: Token is likely plaintext (pre-encryption)
        # Return unchanged to allow graceful migration
        logger.warning(
            "[CRYPTO] Decryption failed - token may be plaintext (pre-encryption). "
            "Returning unchanged for backward compatibility."
        )
        return ciphertext
    except Exception as e:
        logger.error(f"[CRYPTO ERROR] Unexpected decryption error: {str(e)}")
        # Return plaintext for safety (don't break existing sessions)
        return ciphertext


def generate_key() -> str:
    """
    Generate a new Fernet encryption key.
    
    Returns:
        Base64-encoded 32-byte key suitable for OAUTH_TOKEN_ENCRYPTION_KEY
    
    Usage:
        Run this once to generate a key, then save to .env:
        >>> key = generate_key()
        >>> print(f"OAUTH_TOKEN_ENCRYPTION_KEY={key}")
    """
    return Fernet.generate_key().decode()


if __name__ == "__main__":
    # Generate key for setup
    print("Generated encryption key for OAUTH_TOKEN_ENCRYPTION_KEY:")
    print(generate_key())
    print("\nAdd this to your .env file (backend) and Fly.io secrets")
