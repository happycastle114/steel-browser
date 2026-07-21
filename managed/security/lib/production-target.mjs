export const ProductionTarget = Object.freeze({
  MANAGER: "MANAGER",
  WORKER: "WORKER",
});

const productionTargets = new Set(Object.values(ProductionTarget));

export const isProductionTarget = (value) => productionTargets.has(value);

export const productionTargetPolicy = (policy, target) => {
  const targetPolicy = policy.targets?.[target];
  return typeof targetPolicy === "object" && targetPolicy !== null
    ? targetPolicy
    : undefined;
};
