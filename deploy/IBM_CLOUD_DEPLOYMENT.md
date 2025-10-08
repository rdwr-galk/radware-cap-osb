# Radware CAP OSB - IBM Cloud Deployment Guide

This document provides comprehensive instructions for deploying the Radware CAP Open Service Broker to IBM Cloud using Code Engine.

## Prerequisites

1. **IBM Cloud Account**: Sign up at [cloud.ibm.com](https://cloud.ibm.com)
2. **IBM Cloud CLI**: Install from [here](https://cloud.ibm.com/docs/cli)
3. **Code Engine Plugin**: `ibmcloud plugin install code-engine`
4. **Container Registry Access**: Ensure you have access to IBM Container Registry

## Quick Deployment Steps

### 1. Login to IBM Cloud
```bash
ibmcloud login --sso
ibmcloud target -r us-south -g default
```

### 2. Create Cloudant Database Service
```bash
# Create Cloudant service instance
ibmcloud resource service-instance-create radware-osb-cloudant cloudantnosqldb lite us-south

# Get service credentials
ibmcloud resource service-key-create radware-osb-cloudant-key Manager --instance-name radware-osb-cloudant
ibmcloud resource service-key radware-osb-cloudant-key
```

### 3. Create Code Engine Project
```bash
ibmcloud ce project create --name radware-osb-project
ibmcloud ce project select --name radware-osb-project
```

### 4. Set Environment Variables
```bash
# OSB Authentication
ibmcloud ce secret create --name osb-auth \
  --from-literal OSB_BASIC_AUTH_USER=admin \
  --from-literal OSB_BASIC_AUTH_PASS=your-secure-password

# Radware API Configuration
ibmcloud ce secret create --name radware-api \
  --from-literal RADWARE_API_BASE_URL=https://your-radware-api.com \
  --from-literal RADWARE_API_TOKEN=your-api-token

# Cloudant Configuration (replace with actual values from step 2)
ibmcloud ce secret create --name cloudant-config \
  --from-literal CLOUDANT_URL=your-cloudant-url \
  --from-literal CLOUDANT_IAM_APIKEY=your-iam-apikey
```

### 5. Deploy Application
```bash
# Build and deploy from source
ibmcloud ce application create \
  --name radware-cap-osb \
  --build-source https://github.com/rdwr-galk/radware-cap-osb \
  --build-strategy buildpacks \
  --cpu 1 \
  --memory 1Gi \
  --ephemeral-storage 2Gi \
  --min-scale 1 \
  --max-scale 5 \
  --port 3000 \
  --env NODE_ENV=production \
  --env LOG_LEVEL=info \
  --env CLOUDANT_DATABASE_NAME=radware_cap_osb \
  --env METRICS_ENABLED=true \
  --env TRACING_ENABLED=true \
  --env SERVICE_NAME=radware-cap-osb \
  --env SERVICE_NAMESPACE=ibm-cloud \
  --env-from-secret osb-auth \
  --env-from-secret radware-api \
  --env-from-secret cloudant-config
```

### 6. Get Application URL
```bash
ibmcloud ce application get --name radware-cap-osb
```

## Alternative Deployment Methods

### Using CF Manifest (Cloud Foundry)
```bash
# Push using manifest
cf push -f deploy/cf-manifest.yml

# Set environment variables
cf set-env radware-cap-osb OSB_BASIC_AUTH_USER admin
cf set-env radware-cap-osb OSB_BASIC_AUTH_PASS your-secure-password
cf set-env radware-cap-osb RADWARE_API_BASE_URL https://your-radware-api.com
cf set-env radware-cap-osb RADWARE_API_TOKEN your-api-token

# Bind Cloudant service
cf bind-service radware-cap-osb cloudant-service
cf restage radware-cap-osb
```

### Using Docker Image
```bash
# Build and push to IBM Container Registry
ibmcloud cr namespace-add radware-osb
docker build -t us.icr.io/radware-osb/radware-cap-osb:latest .
docker push us.icr.io/radware-osb/radware-cap-osb:latest

# Deploy from container image
ibmcloud ce application create \
  --name radware-cap-osb \
  --image us.icr.io/radware-osb/radware-cap-osb:latest \
  --cpu 1 \
  --memory 1Gi \
  --min-scale 1 \
  --max-scale 5 \
  --port 3000 \
  --env-from-secret osb-auth \
  --env-from-secret radware-api \
  --env-from-secret cloudant-config
```

## Configuration Management

### Required Environment Variables

| Variable | Description | Required | Example |
|----------|-------------|----------|---------|
| `OSB_BASIC_AUTH_USER` | OSB API username | Yes | `admin` |
| `OSB_BASIC_AUTH_PASS` | OSB API password | Yes | `secure-password` |
| `RADWARE_API_BASE_URL` | Radware API endpoint | Yes | `https://api.radware.com` |
| `RADWARE_API_TOKEN` | Radware API token | Yes | `your-token` |
| `CLOUDANT_URL` | Cloudant database URL | Yes | Auto from service binding |
| `CLOUDANT_IAM_APIKEY` | Cloudant IAM API key | Yes | Auto from service binding |

### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Node.js environment | `production` |
| `LOG_LEVEL` | Logging level | `info` |
| `CLOUDANT_DATABASE_NAME` | Database name | `radware_cap_osb` |
| `METRICS_ENABLED` | Enable Prometheus metrics | `true` |
| `TRACING_ENABLED` | Enable OpenTelemetry tracing | `true` |
| `RATE_LIMIT_MAX` | Rate limit per window | `100` |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window (ms) | `900000` |

## Health Monitoring

The application provides several monitoring endpoints:

- **Health Check**: `GET /health` - Application health status
- **Metrics**: `GET /metrics` - Prometheus metrics
- **Service Catalog**: `GET /v2/catalog` - OSB service catalog

### Health Check Response
```json
{
  "status": "UP",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "1.0.0",
  "uptime": 3600,
  "checks": {
    "database": "UP",
    "radware_api": "UP",
    "memory": "OK"
  }
}
```

## Troubleshooting

### Common Issues

1. **Authentication Failures**
   - Verify OSB credentials are set correctly
   - Check that basic auth is properly configured

2. **Database Connection Issues**
   - Ensure Cloudant service is created and bound
   - Verify database credentials and URL

3. **API Integration Problems**
   - Check Radware API token validity
   - Verify API endpoint accessibility

4. **Performance Issues**
   - Monitor metrics endpoint for resource usage
   - Adjust CPU/memory allocation as needed
   - Review rate limiting configuration

### Debugging Commands

```bash
# View application logs
ibmcloud ce application logs --name radware-cap-osb

# Check application status
ibmcloud ce application get --name radware-cap-osb

# View environment variables
ibmcloud ce application get --name radware-cap-osb --output yaml

# Update application configuration
ibmcloud ce application update --name radware-cap-osb --env NEW_VAR=value
```

## Scaling and Performance

### Auto-scaling Configuration
```bash
ibmcloud ce application update --name radware-cap-osb \
  --min-scale 2 \
  --max-scale 10 \
  --concurrency-target 50
```

### Resource Allocation
```bash
ibmcloud ce application update --name radware-cap-osb \
  --cpu 2 \
  --memory 2Gi \
  --ephemeral-storage 4Gi
```

## Security Considerations

1. **Use IBM Secrets Manager** for sensitive configuration
2. **Enable VPC** for network isolation
3. **Configure IAM policies** for fine-grained access control
4. **Enable audit logging** through IBM Cloud Activity Tracker
5. **Use private endpoints** for Cloudant access when possible

## Continuous Deployment

The repository includes Tekton pipeline configuration for automated CI/CD:

1. **Setup Toolchain**: Use `.ibmcloud/toolchain.json`
2. **Pipeline Configuration**: See `.ibmcloud/tekton-pipeline.yml`
3. **Trigger Deployment**: Git push to main branch

## Support

For deployment issues or questions:

1. Review IBM Cloud Code Engine documentation
2. Check application logs for specific error messages
3. Verify all required services and configurations
4. Contact IBM Cloud support for platform-specific issues

---

*Last Updated: January 2024*