require('electron').protocol.registerSchemesAsPrivileged([{ scheme: 'mdmedia', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);
