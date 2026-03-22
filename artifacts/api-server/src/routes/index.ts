import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import lawFirmsRouter from "./law-firms";
import ratesRouter from "./rates";
import usersRouter from "./users";
import invoicesRouter from "./invoices";
import storageRouter from "./storage";
import rulesRouter from "./rules";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(lawFirmsRouter);
router.use(ratesRouter);
router.use(usersRouter);
router.use(invoicesRouter);
router.use(storageRouter);
router.use(rulesRouter);

export default router;
