process.env.NODE_ENV = 'test';
process.env.PORT = '8081';
process.env.LOG_LEVEL = 'error';

// SECURITY COMPLIANCE: Basic authentication deprecated - JWT Bearer CRN required
// IBM Cloud Partner Center compliant configuration
process.env.IBM_BROKER_CRN = 'crn:v1:bluemix:public:radware-cap:us-south:a/7c4d0332e74041ea9bbfc21db410f043::';
process.env.IBM_IAM_ISSUER = 'https://iam.cloud.ibm.com';
process.env.IBM_IAM_AUDIENCE = 'osb-broker';
process.env.IBM_ACCOUNT_ID = '7c4d0332e74041ea9bbfc21db410f043';

process.env.DASHBOARD_BASE = 'http://localhost:8080/dashboard';

process.env.RADWARE_API_BASE_URL = 'https://localhost:9443';
process.env.RADWARE_API_TOKEN = 'dummy-token';
process.env.RADWARE_TIMEOUT = '10000';
process.env.RADWARE_RETRIES = '0';

process.env.ENABLE_ASYNC = 'true';
