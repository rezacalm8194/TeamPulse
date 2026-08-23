const express = require('express');
const { logger } = require('./logger');

function retiredWorkspacePayload(resource) {
  return {
    error: 'legacy_route_retired',
    resource,
    message: 'Workspace data lives in user_data_parts via /api/data. This relational table is not the workspace document.',
    use: '/api/data',
  };
}

function sendRetiredWorkspace(resource) {
  return (req, res) => {
    logger.audit('legacy_route_retired', {
      requestId: req.requestId,
      actorUserId: req.user?.id || null,
      entityType: resource,
      metadata: { method: req.method, path: req.originalUrl },
    });
    res.setHeader('Deprecation', 'true');
    res.status(410).json(retiredWorkspacePayload(resource));
  };
}

function retiredWorkspaceRouter(resource) {
  const auth = require('../middleware/auth');
  const router = express.Router();
  router.use(auth);
  router.use(sendRetiredWorkspace(resource));
  return router;
}

module.exports = {
  retiredWorkspacePayload,
  retiredWorkspaceRouter,
  sendRetiredWorkspace,
};
