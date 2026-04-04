import * as providersNamespace from "../../api/src/providers/index.js";

type ProviderModule = typeof import("../../api/src/providers/index.js");

// Cross-runtime compatibility:
// - In some tsx/dev setups this module is seen as CJS (exports under `default`)
// - In others it is native ESM (named exports)
const providers = (
  "getPricingEngine" in providersNamespace
    ? providersNamespace
    : (providersNamespace as unknown as { default: ProviderModule }).default
) as ProviderModule;

export const getPricingEngine: ProviderModule["getPricingEngine"] = (...args) =>
  providers.getPricingEngine(...args);

export const hasProvider: ProviderModule["hasProvider"] = (...args) =>
  providers.hasProvider(...args);

export const listProviders: ProviderModule["listProviders"] = (...args) =>
  providers.listProviders(...args);

export const findModelInfo: ProviderModule["findModelInfo"] = (...args) =>
  providers.findModelInfo(...args);
