const USER_INSTALL_REPORTING_ENABLED_ENV = 'DRASIL_USER_INSTALL_REPORTING_ENABLED';

export function isUserInstallReportingEnabled(): boolean {
  return process.env[USER_INSTALL_REPORTING_ENABLED_ENV] === 'true';
}
