'use strict';

function mapQuranApiPath(req, res, next) {
  req.url = `/quran${req.url === '/' ? '' : req.url}`;
  next();
}

function mountInfiniteScrollApiRoutes(app, routers) {
  app.use('/api/blog', routers.blogRouter);
  app.use('/quran/api/tafsir', routers.tafsirRouter);
  app.use('/api', routers.searchRouter);
  app.use('/quran/api', mapQuranApiPath, routers.searchRouter);
}

module.exports = {
  mapQuranApiPath,
  mountInfiniteScrollApiRoutes
};
