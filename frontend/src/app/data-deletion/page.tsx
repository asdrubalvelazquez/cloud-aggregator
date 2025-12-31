export default function DataDeletion() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto bg-white shadow-sm rounded-lg p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Data Deletion Instructions</h1>
        
        <p className="text-sm text-gray-600 mb-6">
          <strong>Last Updated:</strong> December 31, 2025
        </p>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">1. Revoking Google Account Access</h2>
          <p className="text-gray-700 mb-4">
            To immediately revoke Cloud Aggregator's access to your Google Drive:
          </p>
          <ol className="list-decimal list-inside text-gray-700 space-y-3 ml-4">
            <li>
              Visit your{' '}
              <a 
                href="https://myaccount.google.com/permissions" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline font-medium"
              >
                Google Account Permissions page
              </a>
            </li>
            <li>Find <strong>"Cloud Aggregator"</strong> in the list of connected apps</li>
            <li>Click on the app name to expand details</li>
            <li>Click the <strong>"Remove Access"</strong> button</li>
            <li>Confirm the removal when prompted</li>
          </ol>
          <p className="text-gray-700 mt-4">
            <strong>Effect:</strong> Cloud Aggregator will immediately lose access to your Google Drive. Any OAuth tokens we stored for your account will become invalid within seconds.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">2. Requesting Account and Data Deletion</h2>
          <p className="text-gray-700 mb-4">
            To request complete deletion of your Cloud Aggregator account and all associated data:
          </p>
          
          <div className="bg-blue-50 border-l-4 border-blue-600 p-4 mb-6">
            <p className="text-gray-800 font-medium">
              <strong>Contact us at:</strong>{' '}
              <a 
                href="mailto:support@cloudaggregatorapp.com" 
                className="text-blue-600 hover:underline"
              >
                support@cloudaggregatorapp.com
              </a>
            </p>
          </div>

          <p className="text-gray-700 mb-4">
            In your email, please include:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
            <li>The email address associated with your Cloud Aggregator account</li>
            <li>Subject line: <strong>"Account Deletion Request"</strong></li>
            <li>Confirmation that you want to permanently delete your account and all data</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">3. Data Deletion Timeline</h2>
          <p className="text-gray-700 mb-4">
            Once we receive your deletion request:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-3 ml-4">
            <li>
              <strong>Immediate:</strong> Your account will be deactivated, preventing any further access to our services
            </li>
            <li>
              <strong>Within 48 hours:</strong> We will confirm receipt of your request via email
            </li>
            <li>
              <strong>Within 30 days:</strong> All your personal data will be permanently deleted from our production databases, including:
              <ul className="list-circle list-inside ml-6 mt-2 space-y-1">
                <li>Account information (email, profile)</li>
                <li>OAuth tokens and credentials</li>
                <li>File operation history and logs</li>
                <li>Usage statistics and quota information</li>
                <li>Billing records (except those required by law for tax/accounting purposes)</li>
              </ul>
            </li>
            <li>
              <strong>Backup retention:</strong> Data in encrypted backups may persist for up to 90 days for disaster recovery purposes, after which it is permanently purged
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">4. What Data We Delete</h2>
          <p className="text-gray-700 mb-4">
            Upon account deletion, we remove:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
            <li><strong>Personal Information:</strong> Email, name, profile data</li>
            <li><strong>OAuth Credentials:</strong> All encrypted access and refresh tokens for connected Google accounts</li>
            <li><strong>Usage Data:</strong> File copy logs, operation history, storage statistics</li>
            <li><strong>Account Settings:</strong> Preferences, connected account configurations, plan details</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">5. Important Notes</h2>
          <div className="bg-yellow-50 border-l-4 border-yellow-600 p-4 mb-4">
            <p className="text-gray-800 font-medium mb-2">⚠️ Data Deletion is Permanent</p>
            <p className="text-gray-700">
              Once your data is deleted from our systems, it <strong>cannot be recovered</strong>. Please ensure you have exported any information you need before requesting deletion.
            </p>
          </div>

          <div className="bg-blue-50 border-l-4 border-blue-600 p-4">
            <p className="text-gray-800 font-medium mb-2">🔒 Your Google Drive Files Are Safe</p>
            <p className="text-gray-700">
              Deleting your Cloud Aggregator account does <strong>not</strong> affect your Google Drive files. All files copied or accessed through our service remain in your Google Drive accounts. We only delete data stored in <em>our</em> systems.
            </p>
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">6. Questions or Concerns</h2>
          <p className="text-gray-700 mb-4">
            If you have questions about data deletion or our data handling practices:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
            <li>
              <strong>Email:</strong>{' '}
              <a 
                href="mailto:support@cloudaggregatorapp.com" 
                className="text-blue-600 hover:underline"
              >
                support@cloudaggregatorapp.com
              </a>
            </li>
            <li>
              <strong>Privacy Policy:</strong>{' '}
              <a 
                href="/privacy" 
                className="text-blue-600 hover:underline"
              >
                www.cloudaggregatorapp.com/privacy
              </a>
            </li>
          </ul>
        </section>

        <div className="mt-12 pt-6 border-t border-gray-200">
          <p className="text-sm text-gray-500 text-center">
            For immediate assistance with account or data deletion, please email{' '}
            <a 
              href="mailto:support@cloudaggregatorapp.com" 
              className="text-blue-600 hover:underline"
            >
              support@cloudaggregatorapp.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
