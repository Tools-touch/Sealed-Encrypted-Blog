import { useNavigation } from "../providers/navigation/NavigationContext";
import { ConnectButton, useCurrentAccount } from "@mysten/dapp-kit";

function copy(text: string) {
  if (!text) return;
  navigator.clipboard?.writeText(text).catch(() => {});
}

const Navbar = () => {
  const { currentPage, navigate } = useNavigation();
  const account = useCurrentAccount();

  const shorten = (addr: string) => {
    if (!addr) return "";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const menuClass = (path: string) =>
    `px-4 py-2 rounded-lg transition-colors ${
      currentPage === path
        ? "bg-white/70 text-blue-700 shadow-sm"
        : "text-white hover:bg-white/20"
    }`;

  return (
    <nav className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 shadow-lg sticky top-0 z-20">
      <div className="max-w-screen-xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-white">
          <div className="h-10 w-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center font-bold">
            🗳️
          </div>
          <div>
            <p className="text-lg font-semibold">SEB</p>
            <p className="text-xs text-white/80">Sealed Encrypted Blog</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/")} className={menuClass("/")}>
            首页
          </button>
          <button onClick={() => navigate("/publish")} className={menuClass("/publish")}>
            发布文章
          </button>
        </div>

        <div className="flex items-center gap-3">
          {account?.address && (
            <div className="flex items-center gap-2 bg-white/15 text-white px-3 py-2 rounded-lg backdrop-blur">
              <div className="h-2 w-2 rounded-full bg-emerald-300 animate-pulse" />
              <span className="font-mono text-sm">{shorten(account.address)}</span>
              <button
                onClick={() => copy(account.address)}
                className="text-xs underline hover:text-yellow-200"
                title="复制地址"
              >
                复制
              </button>
            </div>
          )}
          <ConnectButton />
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
