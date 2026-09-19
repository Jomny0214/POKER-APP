import { run as runEvaluatorTests } from "./evaluator.test";
import { run as runSimulation } from "./simulate";

runEvaluatorTests();
runSimulation();
console.log("ALL ENGINE TESTS PASSED");
