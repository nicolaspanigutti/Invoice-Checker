import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import lawFirmsRouter from "./law-firms";
import ratesRouter from "./rates";
import usersRouter from "./users";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(lawFirmsRouter);
router.use(ratesRouter);
router.use(usersRouter);

export default router;
