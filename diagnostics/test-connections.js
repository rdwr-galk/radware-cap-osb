#!/usr/bin/env node
/**
 * Diagnostic script to test Cloudant and Radware API connectivity
 * Usage: node diagnostics/test-connections.js
 * 
 * Exit codes:
 * 0 - All connections successful
 * 1 - One or more connection failures
 */

const loadConfig = require('../src/config');

// ANSI color codes for better console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function colorize(color, text) {
  return `${colors[color]}${text}${colors.reset}`;
}

function printHeader(title) {
  const line = '='.repeat(60);
  console.log(colorize('cyan', line));
  console.log(colorize('cyan', `  ${title}`));
  console.log(colorize('cyan', line));
}

function printSubHeader(title) {
  console.log('\n' + colorize('blue', `--- ${title} ---`));
}

function printSuccess(message) {
  console.log(colorize('green', `✅ ${message}`));
}

function printWarning(message) {
  console.log(colorize('yellow', `⚠️  ${message}`));
}

function printError(message) {
  console.log(colorize('red', `❌ ${message}`));
}

function printInfo(message) {
  console.log(colorize('blue', `ℹ️  ${message}`));
}

async function testCloudantConnection() {
  printSubHeader('CLOUDANT DATABASE TEST');
  
  try {
    // Test configuration loading
    console.log('Loading configuration...');
    const config = await loadConfig();
    
    if (config.database.type !== 'cloudant') {
      printWarning('Database type is not cloudant, skipping Cloudant tests');
      return { success: true, skipped: true };
    }

    // Display configuration (without sensitive data)
    console.log('\nCloudant Configuration:');
    console.log(`  Database Type: ${config.database.type}`);
    console.log(`  Database Name: ${config.database.cloudant.database}`);
    console.log(`  Has CLOUDANT_URL: ${!!process.env.CLOUDANT_URL}`);
    console.log(`  Has CLOUDANT_APIKEY: ${!!process.env.CLOUDANT_APIKEY}`);
    
    if (process.env.CLOUDANT_URL) {
      const url = new URL(process.env.CLOUDANT_URL);
      console.log(`  Host: ${url.host}`);
      console.log(`  Has IAM Bearer: ${process.env.CLOUDANT_URL.includes('iamBearer=')}`);
    }

    // Test Cloudant store initialization
    console.log('\nInitializing Cloudant store...');
    const store = require('../src/store/cloudantStore');
    
    console.log('Testing Cloudant connectivity...');
    const startTime = Date.now();
    const pingResult = await store.ping();
    const latency = Date.now() - startTime;

    if (pingResult) {
      printSuccess(`Cloudant connection successful (${latency}ms)`);
      
      // Test database operations
      console.log('Testing database operations...');
      try {
        // Try to get database info
        await store._ensureDatabase();
        printSuccess('Database initialization successful');
        return { success: true, latency };
      } catch (dbError) {
        printError(`Database operations failed: ${dbError.message}`);
        return { success: false, error: dbError.message };
      }
    } else {
      printError('Cloudant connection failed');
      return { success: false, error: 'Connection test failed' };
    }

  } catch (error) {
    printError(`Cloudant test failed: ${error.message}`);
    console.log('\nError details:');
    console.log(`  Error code: ${error.code || 'N/A'}`);
    console.log(`  Error status: ${error.status || 'N/A'}`);
    if (error.response?.data) {
      console.log(`  Response data: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    return { success: false, error: error.message };
  }
}

async function testRadwareConnection() {
  printSubHeader('RADWARE API TEST');
  
  try {
    // Test configuration loading
    console.log('Loading configuration...');
    const config = await loadConfig();
    
    // Display configuration (without sensitive data)
    console.log('\nRadware Configuration:');
    console.log(`  API Base URL: ${config.radware.apiBase}`);
    console.log(`  Has API Token: ${!!config.radware.apiToken}`);
    console.log(`  Timeout: ${config.radware.timeout}ms`);
    console.log(`  Retries: ${config.radware.retries}`);
    console.log(`  Gateway Role ID: ${config.radware.gatewaySystemRoleId || 'not set'}`);

    if (!config.radware.apiToken) {
      printWarning('RADWARE_API_TOKEN not configured - authentication may fail');
    }

    // Test Radware API initialization
    console.log('\nInitializing Radware API client...');
    const RadwareApi = require('../src/services/radwareApi');
    const radwareApi = await RadwareApi.newInstance();
    printSuccess('Radware API client initialized');

    // Test connectivity
    console.log('Testing Radware API connectivity...');
    const startTime = Date.now();
    const pingResult = await radwareApi.ping();
    const latency = Date.now() - startTime;

    if (pingResult) {
      printSuccess(`Radware API connection successful (${latency}ms)`);
      return { success: true, latency };
    } else {
      printError('Radware API connection failed');
      return { success: false, error: 'Connection test failed' };
    }

  } catch (error) {
    printError(`Radware API test failed: ${error.message}`);
    console.log('\nError details:');
    console.log(`  Error code: ${error.code || 'N/A'}`);
    console.log(`  Error status: ${error.status || 'N/A'}`);
    if (error.response?.data) {
      console.log(`  Response data: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    return { success: false, error: error.message };
  }
}

async function main() {
  printHeader('RADWARE CAP OSB - CONNECTION DIAGNOSTICS');
  
  console.log(colorize('magenta', 'Testing connectivity to external services...\n'));
  
  // Environment info
  console.log('Environment Information:');
  console.log(`  Node.js Version: ${process.version}`);
  console.log(`  Platform: ${process.platform}`);
  console.log(`  NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);

  const results = {
    cloudant: await testCloudantConnection(),
    radware: await testRadwareConnection()
  };

  // Summary
  printHeader('TEST SUMMARY');
  
  let allPassed = true;
  
  console.log('Test Results:');
  
  // Cloudant results
  if (results.cloudant.skipped) {
    console.log(`  Cloudant: ${colorize('yellow', 'SKIPPED')} (not configured)`);
  } else if (results.cloudant.success) {
    console.log(`  Cloudant: ${colorize('green', 'PASS')} (${results.cloudant.latency}ms)`);
  } else {
    console.log(`  Cloudant: ${colorize('red', 'FAIL')} - ${results.cloudant.error}`);
    allPassed = false;
  }
  
  // Radware results
  if (results.radware.success) {
    console.log(`  Radware:  ${colorize('green', 'PASS')} (${results.radware.latency}ms)`);
  } else {
    console.log(`  Radware:  ${colorize('red', 'FAIL')} - ${results.radware.error}`);
    allPassed = false;
  }
  
  console.log();
  
  if (allPassed) {
    printSuccess('All connection tests passed! 🎉');
    console.log('\nThe application should be able to connect to all external services.');
    process.exit(0);
  } else {
    printError('Some connection tests failed! 💥');
    console.log('\nReview the error messages above and check:');
    console.log('  1. Environment variables (API keys, URLs)');
    console.log('  2. Network connectivity');
    console.log('  3. Service availability');
    process.exit(1);
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('\n' + colorize('red', 'Unhandled promise rejection:'), reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('\n' + colorize('red', 'Uncaught exception:'), error);
  process.exit(1);
});

// Run the diagnostics
main().catch((error) => {
  console.error('\n' + colorize('red', 'Diagnostic script failed:'), error);
  process.exit(1);
});