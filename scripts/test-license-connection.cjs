const { requestLicense } = require('../dist/pro/licenseClient');

requestLicense('validate', { license_key: 'gridlens-invalid-connectivity-probe' })
  .then(response => {
    if (!response || response.valid !== false || typeof response.error !== 'string') throw new Error('Unexpected probe response');
    console.log('HTTPS license service reachable. Certificate verification remains enabled; no real key was used.');
  })
  .catch(() => {
    console.error('License service connectivity check failed. No real key was used.');
    process.exitCode = 1;
  });