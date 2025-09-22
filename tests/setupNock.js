const nock = require('nock');

// Prime mock responses for Radware API
global.primeRadwareMocks = function(options = {}) {
  const {
    provisionDelay = 100,
    deprovisionDelay = 100,
    createUserSuccess = true,
    deleteUserSuccess = true
  } = options;

  // Mock provision requests - create account
  nock('https://localhost:9443')
    .put('/api/sdcc/system/entity/accounts?databaseType=ORIGIN')
    .reply(200, { id: 'acc-123', name: 'Test Account' });

  // Mock provision requests - create service
  nock('https://localhost:9443')
    .put('/api/sdcc/system/entity/services?databaseType=ORIGIN')
    .reply(200, { id: 'svc-123', accountId: 'acc-123', type: 'CWAF' });

  // Mock deprovision requests - delete service
  nock('https://localhost:9443')
    .delete(/\/api\/sdcc\/system\/entity\/services\/.*\?databaseType=ORIGIN/)
    .reply(200, { message: 'Service deleted' });

  // Mock deprovision requests - delete account
  nock('https://localhost:9443')
    .delete(/\/api\/sdcc\/system\/entity\/accounts\/.*\?databaseType=ORIGIN/)
    .reply(200, { message: 'Account deleted' });

  // Mock create user (bind)
  nock('https://localhost:9443')
    .put('/api/sdcc/system/entity/users?databaseType=ORIGIN')
    .reply(createUserSuccess ? 200 : 400, 
           createUserSuccess ? { id: 'u-123', email: 'user@example.com', accountId: 'acc-123' } : { error: 'User creation failed' });

  // Mock delete user (unbind)
  nock('https://localhost:9443')
    .delete(/\/api\/sdcc\/system\/entity\/users\/.*\?databaseType=ORIGIN/)
    .reply(deleteUserSuccess ? 200 : 404, 
           deleteUserSuccess ? { message: 'User deleted' } : { error: 'User not found' });

  // Mock service plan update (patch)
  nock('https://localhost:9443')
    .post(/\/api\/sdcc\/system\/entity\/services\/.*\?databaseType=ORIGIN/)
    .reply(200, { id: 'svc-123', planId: 'premium' });
};

beforeAll(() => {
  nock.disableNetConnect();
  // Allow local connections for the test server
  nock.enableNetConnect('127.0.0.1');
});

afterEach(() => {
  try {
    nock.cleanAll();
  } catch (error) {
    console.warn('Error cleaning nock:', error.message);
  }
});

afterAll(() => {
  nock.enableNetConnect();
});
