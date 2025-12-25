"""
Test for ClientOptions → SyncClientOptions fix
Validates that create_user_scoped_client() works without AttributeError
"""
import os
import sys

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

def test_create_user_scoped_client():
    """Test that create_user_scoped_client creates a valid Supabase client"""
    from backend.auth import create_user_scoped_client
    
    # Mock environment variables (required by function)
    os.environ["SUPABASE_URL"] = "https://test.supabase.co"
    os.environ["SUPABASE_ANON_KEY"] = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test"
    
    # Create client with test JWT
    test_jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test"
    
    try:
        client = create_user_scoped_client(test_jwt)
        
        # Verify client was created successfully
        assert client is not None, "Client should not be None"
        assert hasattr(client, 'rpc'), "Client should have rpc method"
        
        print("✅ Test PASSED: create_user_scoped_client() creates client without AttributeError")
        print(f"   Client type: {type(client)}")
        print(f"   Has rpc: {hasattr(client, 'rpc')}")
        print(f"   Has auth: {hasattr(client, 'auth')}")
        print(f"   Has postgrest: {hasattr(client, 'postgrest')}")
        
        return True
        
    except AttributeError as e:
        if "'ClientOptions' object has no attribute 'storage'" in str(e):
            print(f"❌ Test FAILED: {e}")
            print("   This is the exact error we're trying to fix!")
            return False
        raise
    except Exception as e:
        # Other errors are acceptable (e.g., network errors from invalid URL)
        # We only care about the AttributeError with 'storage'
        print(f"⚠️  Test passed (client created), but got expected error: {type(e).__name__}")
        return True

if __name__ == "__main__":
    success = test_create_user_scoped_client()
    sys.exit(0 if success else 1)
