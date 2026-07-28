// backend/src/app.js
'use strict';

/**
 * Express application assembly.
 *
 * Exported without calling listen() so the integration suite can mount it with
 * Supertest and drive it in-process — no port binding, no server lifecycle to
 * manage between tests. src/server.js owns listening.
 *
 * Middleware order is load-bearing and listed top to bottom below.
 */

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');

const config = require('./config');
const logger = require('./utils/logger');
const { globalLimiter } = require('./middleware/rateLimit');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const v1Routes = require('./routes/v1');
const { openApiSpec, mountSwagger } = require('./docs');

function createApp() {
  const app = express();

  // Behind nginx/ALB, req.ip must come from X-Forwarded-For or rate limiting
  // keys every request to the proxy's address. Off by default so a direct
  // deployment cannot be trivially spoofed by a client-sent header. See
  // config.trustProxy for the full reasoning.
  if (config.trustProxy !== false) {
    app.set('trust proxy', config.trustProxy);
  }

  app.disable('x-powered-by');

  // --- Security headers ------------------------------------------------------
  app.use(
    helmet({
      // The API serves JSON and user-uploaded images, never HTML documents, so
      // the document-oriented CSP directives do not apply. Swagger UI, the one
      // HTML surface, needs inline styles and is dev-only.
      contentSecurityPolicy: config.isProduction
        ? {
            directives: {
              defaultSrc: ["'none'"],
              imgSrc: ["'self'", 'data:'],
              styleSrc: ["'self'", "'unsafe-inline'"],
              scriptSrc: ["'self'"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
      // Uploaded images are fetched cross-origin by the frontend dev server on
      // :3000; the default same-origin policy would block them.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );

  // --- CORS ------------------------------------------------------------------
  // Locked to the configured origin list. `credentials` is enabled so that a
  // future move of the refresh token into an httpOnly cookie needs no CORS
  // change; today both tokens travel in the JSON body and the Authorization
  // header, so nothing depends on it yet.
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin/server-to-server requests send no Origin header.
        if (!origin) return callback(null, true);
        if (config.corsOrigin === '*') return callback(null, true);
        const normalised = origin.replace(/\/$/, '');
        if (config.corsOrigin.includes(normalised)) return callback(null, true);
        logger.warn('Blocked cross-origin request', { origin, allowed: config.corsOrigin });
        // Reject by declining the CORS headers rather than throwing: the
        // browser reports a clean CORS failure and we avoid a noisy 500.
        return callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      exposedHeaders: ['X-Total-Count', 'RateLimit', 'RateLimit-Policy'],
      maxAge: 600,
    })
  );

  app.use(compression());

  // --- Request logging -------------------------------------------------------
  if (!config.isTest) {
    app.use(
      morgan(config.isProduction ? 'combined' : 'dev', {
        stream: { write: (line) => logger.info(line.trimEnd()) },
        // Health checks would otherwise dominate the log volume.
        skip: (req) => req.path === '/health',
      })
    );
  }

  // --- Body parsing ----------------------------------------------------------
  // Generated articles with inline block content are large; 2mb of JSON is
  // comfortably above the biggest realistic content_blocks payload while still
  // bounding memory per request. Multipart uploads bypass this and are bounded
  // separately by Multer.
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // --- Static uploads --------------------------------------------------------
  // Mirrors the production path convention (blogs/{Month}{Year}/file.png) so a
  // stored blog_picture value resolves identically in dev and prod. When
  // STORAGE_DRIVER=s3 this is unused and the CDN serves these paths instead.
  if (config.storage.driver === 'local') {
    app.use(
      config.storage.publicPath,
      express.static(config.storage.uploadsDir, {
        maxAge: config.isProduction ? '30d' : 0,
        // Uploads are images, never executable content; refuse to guess.
        index: false,
        dotfiles: 'deny',
        setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
      })
    );
  }

  // --- Health / meta ---------------------------------------------------------
  // Unversioned and unauthenticated so load balancers and the frontend's
  // feature-flag bootstrap can both read it.
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      env: config.env,
      uptimeSeconds: Math.round(process.uptime()),
      database: config.database.dialect,
      features: {
        // Lets the UI hide SERP-dependent controls instead of offering an
        // option that would fail. See Section 3/6 of the spec.
        serpApi: config.serp.enabled,
        textProvider: config.ai.textProvider,
        imageProvider: config.ai.imageProvider,
        storageDriver: config.storage.driver,
      },
    });
  });

  // --- API docs --------------------------------------------------------------
  // Swagger UI is a dev/staging affordance; the raw spec stays available
  // everywhere so it can be linted or fed to a client generator in CI.
  app.get('/openapi.json', (req, res) => res.json(openApiSpec));
  if (!config.isProduction) mountSwagger(app);

  // --- Routes ----------------------------------------------------------------
  app.use(config.apiPrefix, globalLimiter, v1Routes);

  // Anything unmatched is a 404 in the standard error envelope.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
