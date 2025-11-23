
import { getFullnodeUrl } from "@mysten/sui/client" ;
import { createNetworkConfig } from "@mysten/dapp-kit";
import {
  DEVNET_ADMIN_CAP,
  DEVNET_DASHBOARD_ID,
  DEVNET_PACKAGE_ID,
  LOCAL_ADMIN_CAP,
  LOCAL_DASHBOARD_ID,
  LOCAL_PACKAGE_ID,
  MAINNET_ADMIN_CAP,
  MAINNET_DASHBOARD_ID,
  MAINNET_PACKAGE_ID,
  TESTNET_ADMIN_CAP,
  TESTNET_DASHBOARD_ID,
  TESTNET_PACKAGE_ID
} from "../constants";


const { networkConfig, useNetworkVariable } = createNetworkConfig({
  localnet: {
    url: getFullnodeUrl("localnet"),
    variables: {
      dashboardId: LOCAL_DASHBOARD_ID,
      packageId: LOCAL_PACKAGE_ID,
      adminCapId: LOCAL_ADMIN_CAP,
    }
  },
  devnet: {
    url: getFullnodeUrl("devnet"),
    variables: {
      dashboardId: DEVNET_DASHBOARD_ID,
      packageId: DEVNET_PACKAGE_ID,
      adminCapId: DEVNET_ADMIN_CAP,
    }
  },
  testnet: {
    url: getFullnodeUrl("testnet"),
    variables: {
      dashboardId: TESTNET_DASHBOARD_ID,
      packageId: TESTNET_PACKAGE_ID,
      adminCapId: TESTNET_ADMIN_CAP,
    }
  },
  mainnet: {
    url: getFullnodeUrl("mainnet"),
    variables: {
      dashboardId: MAINNET_DASHBOARD_ID,
      packageId: MAINNET_PACKAGE_ID,
      adminCapId: MAINNET_ADMIN_CAP,
    }
  },
});

export { networkConfig, useNetworkVariable };
