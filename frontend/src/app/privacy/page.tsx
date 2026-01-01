"use client";

import { useRouter } from "next/navigation";

export default function PrivacyPolicy() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto bg-white shadow-sm rounded-lg p-8">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="relative z-10 inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-6"
        >
          <span>←</span>
          <span>Back to Home</span>
        </button>
        
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Privacy Policy</h1>
        
        <p className="text-sm text-gray-600 mb-6">
          <strong>Effective Date:</strong> December 19, 2025
        </p>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">1. Introduction</h2>
          <p className="text-gray-700 mb-4">
            Cloud Aggregator ("we", "our", or "us"), accessible at www.cloudaggregatorapp.com, is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your information when you use our service to manage and interact with your Google Drive accounts.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">2. Information We Collect</h2>
          <p className="text-gray-700 mb-4">
            When you use Cloud Aggregator, we collect and process the following information:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
            <li><strong>Google Account Information:</strong> Email address, profile information, and authentication tokens obtained through Google OAuth.</li>
            <li><strong>Google Drive Data:</strong> File names, folder structures, file metadata, and storage usage from the Google Drive accounts you choose to connect.</li>
            <li><strong>Usage Data:</strong> Information about your interactions with our service, including copy operations, file management actions, and quota usage.</li>
          </ul>
          <p className="text-gray-700 mt-4">
            <strong>Important:</strong> We use the <code className="bg-gray-100 px-2 py-1 rounded text-sm">drive.file</code> OAuth scope, which means we <strong>only access files you explicitly select</strong> via Google Picker or files that you create through our service. We cannot see or access your entire Google Drive—only the specific files you choose to work with.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">3. How We Use Your Information</h2>
          <p className="text-gray-700 mb-4">
            We use your information solely to provide and improve our service:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
            <li><strong>Service Delivery:</strong> To authenticate your identity, connect to your Google Drive accounts, and perform file operations that you explicitly request (copy, rename, download, view).</li>
            <li><strong>Duplicate Detection:</strong> To analyze file metadata and prevent unnecessary duplicate copies.</li>
            <li><strong>Quota Management:</strong> To enforce plan-based limits and track your usage of copy operations.</li>
            <li><strong>Service Improvement:</strong> To understand usage patterns and improve service performance and reliability.</li>
          </ul>
          <p className="text-gray-700 mt-4">
            <strong>We do not:</strong>
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
            <li>Sell your data to third parties</li>
            <li>Use your data for advertising purposes</li>
            <li>Access your files without your explicit action</li>
            <li>Share your data except as required by law or as necessary to provide the service</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">4. Google API Services User Data Policy</h2>
          <p className="text-gray-700 mb-4">
            Cloud Aggregator's use of information received from Google APIs complies with the Google API Services User Data Policy (https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.
          </p>
          <p className="text-gray-700 mb-4">
            We access Google user data only to provide the user-facing features explicitly requested by the user (such as selecting files via Google Picker and performing requested copy/rename actions). We do not use Google user data to develop, improve, or train generalized artificial intelligence (AI) or machine learning (ML) models.
          </p>
          <p className="text-gray-700 mb-4">
            We do not transfer Google user data to third parties except as necessary to provide the service or as required by law. Google user data is accessed only when you explicitly initiate an action in the app and is not retained longer than necessary to complete the requested operation.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">5. Data Storage and Security</h2>
          <p className="text-gray-700 mb-4">
            We implement industry-standard security measures to protect your information:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
            <li>All data transmission is encrypted using HTTPS/TLS</li>
            <li>Authentication tokens are securely stored and encrypted</li>
            <li>Access to your data is restricted to authorized service operations only</li>
            <li>We use Supabase for secure data storage with row-level security policies</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">6. Data Retention</h2>
          <p className="text-gray-700 mb-4">
            We retain your information only for as long as necessary to provide our services:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
            <li><strong>Active Accounts:</strong> Account data and usage history are retained while your account is active.</li>
            <li><strong>Operational Data:</strong> File operation logs are retained for 30 days for troubleshooting and service improvement.</li>
            <li><strong>Deleted Accounts:</strong> When you delete your account, we remove your personal data within 30 days, except where retention is required by law.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">7. Third-Party Services</h2>
          <p className="text-gray-700 mb-4">
            Cloud Aggregator integrates with the following third-party services:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
            <li><strong>Google Drive API:</strong> To access and manage your Google Drive files</li>
            <li><strong>Supabase:</strong> For secure authentication and data storage</li>
            <li><strong>Vercel:</strong> For application hosting and delivery</li>
          </ul>
          <p className="text-gray-700 mt-4">
            These services have their own privacy policies and data handling practices. We recommend reviewing their policies.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">8. Your Rights and Choices</h2>
          <p className="text-gray-700 mb-4">You have the following rights regarding your data:</p>
          <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
            <li><strong>Access:</strong> Request a copy of your personal data</li>
            <li><strong>Correction:</strong> Update or correct your information</li>
            <li><strong>Deletion:</strong> Request deletion of your account and associated data at{' '}
              <a 
                href="https://www.cloudaggregatorapp.com/data-deletion" 
                className="text-blue-600 hover:underline"
              >
                https://www.cloudaggregatorapp.com/data-deletion
              </a>
              {' '}(see our{' '}
              <a 
                href="/data-deletion" 
                className="text-blue-600 hover:underline"
              >
                Data Deletion Instructions
              </a>)
            </li>
            <li><strong>Revoke Access:</strong> Disconnect your Google account at any time through your{' '}
              <a 
                href="https://myaccount.google.com/permissions" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                Google Account settings
              </a>
            </li>
            <li><strong>Data Portability:</strong> Request your data in a portable format</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">9. Children's Privacy</h2>
          <p className="text-gray-700 mb-4">
            Cloud Aggregator is not intended for use by individuals under the age of 13. We do not knowingly collect personal information from children under 13. If you believe we have collected information from a child under 13, please contact us immediately.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">10. Changes to This Privacy Policy</h2>
          <p className="text-gray-700 mb-4">
            We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the new Privacy Policy on this page and updating the "Effective Date" at the top. Your continued use of Cloud Aggregator after any changes constitutes acceptance of the updated policy.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">11. Contact Us</h2>
          <p className="text-gray-700 mb-4">
            If you have any questions about this Privacy Policy or our data practices, please contact us at:
          </p>
          <p className="text-gray-700">
            <strong>Email:</strong>{' '}
            <a 
              href="mailto:support@cloudaggregatorapp.com" 
              className="text-blue-600 hover:underline"
            >
              support@cloudaggregatorapp.com
            </a>
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">12. Compliance</h2>
          <p className="text-gray-700 mb-4">
            Cloud Aggregator complies with applicable data protection laws, including:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
            <li>General Data Protection Regulation (GDPR) for European users</li>
            <li>California Consumer Privacy Act (CCPA) for California residents</li>
            <li>Google API Services User Data Policy</li>
          </ul>
        </section>

        <div className="mt-12 pt-8 border-t border-gray-200">
          <p className="text-sm text-gray-600 text-center">
            Last updated: December 19, 2025
          </p>
        </div>
      </div>
    </div>
  );
}
