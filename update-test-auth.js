/**
 * Helper script to update all test files to use JWT Bearer authentication
 * Replaces deprecated Basic Auth with security-compliant Bearer CRN tokens
 */

const fs = require('fs');
const path = require('path');

// Find all test files that need updating
const testFiles = [
  'tests/osb.async.required.test.js',
  'tests/osb.bind.validation.test.js', 
  'tests/osb.delete.validation.test.js',
  'tests/osb.e2e.int.test.js'
];

// Common replacements
const replacements = [
  // Import getBearerAuth
  {
    from: /const request = require\('supertest'\);\nconst app = require\('\.\.\/server'\);/,
    to: "const request = require('supertest');\nconst app = require('../server');\nconst { getBearerAuth } = require('./testJwtUtil');"
  },
  // Replace basic auth functions
  {
    from: /function auth\(\) \{\s*return 'Basic ' \+ Buffer\.from\('admin:secret'\)\.toString\('base64'\);\s*\}/,
    to: "// Using JWT Bearer authentication - getBearerAuth() from testJwtUtil"
  },
  {
    from: /function basicAuth\(\) \{\s*return 'Basic ' \+ Buffer\.from\('admin:secret'\)\.toString\('base64'\);\s*\}/,
    to: "// Using JWT Bearer authentication - getBearerAuth() from testJwtUtil"
  },
  // Replace auth() calls
  {
    from: /\.set\('Authorization', auth\(\)\)/g,
    to: ".set('Authorization', getBearerAuth())"
  },
  // Replace .auth() calls
  {
    from: /\.auth\('admin', 'secret'\)/g,
    to: ".set('Authorization', getBearerAuth())"
  },
  // Replace AUTH constant
  {
    from: /const AUTH = \{ Authorization: basicAuth\(\) \};/,
    to: "const AUTH = { Authorization: getBearerAuth() };"
  }
];

console.log('🔧 Updating test files to use JWT Bearer authentication...\n');

testFiles.forEach(testFile => {
  const filePath = path.resolve(testFile);
  
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  File not found: ${testFile}`);
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  let updated = false;

  replacements.forEach(({ from, to }) => {
    const matches = content.match(from);
    if (matches) {
      content = content.replace(from, to);
      updated = true;
    }
  });

  if (updated) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Updated: ${testFile}`);
  } else {
    console.log(`📝 No changes needed: ${testFile}`);
  }
});

console.log('\n🎯 Basic Auth -> JWT Bearer conversion complete!');
console.log('🔐 All tests now use security-compliant Bearer CRN authentication');