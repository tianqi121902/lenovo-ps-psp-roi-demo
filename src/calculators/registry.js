import { calculatePsPspRoi } from "./psPspRoiCalculator.js";

const calculators = {
  "ps-psp-roi": {
    calculate: calculatePsPspRoi
  }
};

export function getCalculator(serviceType) {
  const calculator = calculators[serviceType];
  if (!calculator) {
    throw new Error(`Unsupported service type: ${serviceType}`);
  }
  return calculator;
}
