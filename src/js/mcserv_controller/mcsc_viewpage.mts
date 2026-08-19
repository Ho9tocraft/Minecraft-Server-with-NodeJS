import { Router } from 'express';

export const createMCSCPageRouter = (): Router => {
  const router = Router();

  router.get('/', (_req, res): void => {
    res.set('Cache-Control', 'no-store');
    res.render('index');
  });

  return router;
}
