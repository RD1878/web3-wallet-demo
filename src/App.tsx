import { useEffect, useState, useCallback } from "react";
import {
    BrowserProvider,
    JsonRpcSigner,
    formatEther,
    Contract,
    formatUnits,
} from "ethers";

import { erc20Abi } from "./abi/erc20"; // наш минимальный ABI для ERC-20

type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

// Расширяем состояние кошелька счётчиками для токена
interface WalletState {
    address: string | null;
    chainId: number | null;
    balanceEth: string | null;

    // Поля, связанные с токеном (ERC-20)
    tokenSymbol: string | null;
    tokenBalance: string | null; // уже форматированное значение с учётом decimals

    status: ConnectionState;
    error: string | null;
}

// Адрес контракта USDC в сети Ethereum mainnet (как пример).
// В реальном проекте такие адреса обычно лежат в конфиге.
const USDC_MAINNET_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

// Ожидаемый chainId (1 = Ethereum mainnet)
const EXPECTED_CHAIN_ID = 1;

function App() {
    const [wallet, setWallet] = useState<WalletState>({
        address: null,
        chainId: null,
        balanceEth: null,
        tokenSymbol: null,
        tokenBalance: null,
        status: "disconnected",
        error: null,
    });

    const [provider, setProvider] = useState<BrowserProvider | null>(null);
    const [signer, setSigner] = useState<JsonRpcSigner | null>(null);

    // 1. Инициализируем BrowserProvider
    useEffect(() => {
        if (typeof window !== "undefined" && (window as any).ethereum) {
            const eth = (window as any).ethereum;
            const browserProvider = new BrowserProvider(eth);
            setProvider(browserProvider);
        } else {
            setWallet((prev) => ({
                ...prev,
                status: "error",
                error: "Кошелёк не найден. Установите MetaMask или совместимый wallet.",
            }));
        }
    }, []);

    // Хелпер для сброса состояния
    const resetWalletState = useCallback(() => {
        setWallet({
            address: null,
            chainId: null,
            balanceEth: null,
            tokenSymbol: null,
            tokenBalance: null,
            status: "disconnected",
            error: null,
        });
        setSigner(null);
    }, []);

    // Функция, которая:
    // 1) подключает кошелёк
    // 2) читает ETH баланс и chainId
    // 3) читает данные ERC-20 токена (symbol, decimals, balanceOf)
    const connectWallet = useCallback(async () => {
        if (!provider) {
            setWallet((prev) => ({
                ...prev,
                status: "error",
                error: "Провайдер не инициализирован (нет window.ethereum).",
            }));
            return;
        }

        try {
            setWallet((prev) => ({ ...prev, status: "connecting", error: null }));

            const eth = (window as any).ethereum;

            // Запрашиваем доступ к аккаунтам
            const accounts: string[] = await eth.request({
                method: "eth_requestAccounts",
            });

            if (!accounts || accounts.length === 0) {
                throw new Error("Нет доступных аккаунтов");
            }

            const userAddress = accounts[0];

            // Получаем signer и сеть
            const nextSigner = await provider.getSigner(userAddress);
            const network = await provider.getNetwork();

            // Читаем ETH баланс
            const balanceWei = await provider.getBalance(userAddress);
            const balanceEth = formatEther(balanceWei);

            // Создаём объект контракта ERC-20.
            // Важно: для чтения (view-функции) нам достаточно provider.
            const tokenContract = new Contract(
                USDC_MAINNET_ADDRESS, // адрес контракта в сети
                erc20Abi,             // наш минимальный ABI
                provider              // читаем через провайдер (без необходимости signer)
            );

            // Читаем символ токена и decimals параллельно
            const [symbol, decimals] = await Promise.all([
                tokenContract.symbol(),
                tokenContract.decimals(),
            ]);

            // Читаем "сырое" значение баланса (целое число без учёта decimals)
            const rawTokenBalance = await tokenContract.balanceOf(userAddress);

            // formatUnits учитывает decimals и возвращает строку с плавающей запятой,
            // например: "12.345678"
            const formattedTokenBalance = formatUnits(rawTokenBalance, decimals);

            setSigner(nextSigner);
            setWallet({
                address: userAddress,
                chainId: Number(network.chainId),
                balanceEth,
                tokenSymbol: symbol,
                tokenBalance: formattedTokenBalance,
                status: "connected",
                error: null,
            });
        } catch (error: any) {
            console.error(error);
            setWallet((prev) => ({
                ...prev,
                status: "error",
                error: error?.message ?? "Ошибка при подключении кошелька или чтении токена",
            }));
        }
    }, [provider]);

    // Подписка на события MetaMask (аналогично модулю 1)
    useEffect(() => {
        const eth = (window as any).ethereum;
        if (!eth) return;

        const handleAccountsChanged = (accounts: string[]) => {
            if (!accounts || accounts.length === 0) {
                resetWalletState();
            } else {
                // Переподключаемся и перечитываем данные токена для нового аккаунта
                connectWallet();
            }
        };

        const handleChainChanged = (_chainIdHex: string) => {
            // Смена сети => перечитываем всё (в том числе баланс токена в новой сети).
            connectWallet();
        };

        eth.on("accountsChanged", handleAccountsChanged);
        eth.on("chainChanged", handleChainChanged);

        return () => {
            if (!eth.removeListener) return;
            eth.removeListener("accountsChanged", handleAccountsChanged);
            eth.removeListener("chainChanged", handleChainChanged);
        };
    }, [connectWallet, resetWalletState]);

    const shortAddress =
        wallet.address && `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`;

    const isWrongNetwork =
        wallet.chainId !== null && wallet.chainId !== EXPECTED_CHAIN_ID;

    return (
        <div
            style={{
                minHeight: "100vh",
                fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#0f172a",
                color: "white",
            }}
        >
            <div
                style={{
                    padding: "24px",
                    borderRadius: "16px",
                    background: "#020617",
                    border: "1px solid #1f2937",
                    width: "100%",
                    maxWidth: "520px",
                    boxShadow: "0 20px 30px rgba(0,0,0,0.4)",
                }}
            >
                <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>
                    ERC-20 Token Reader
                </h1>

                {!provider && (
                    <p>
                        Кошелёк не найден. Установите MetaMask или другой Ethereum‑кошелёк.
                    </p>
                )}

                {provider && wallet.status === "disconnected" && (
                    <button
                        onClick={connectWallet}
                        style={{
                            padding: "0.75rem 1.5rem",
                            borderRadius: "999px",
                            border: "none",
                            cursor: "pointer",
                            background: "linear-gradient(135deg, #4f46e5, #06b6d4)",
                            color: "white",
                            fontWeight: 600,
                        }}
                    >
                        Подключить кошелёк и прочитать USDC
                    </button>
                )}

                {wallet.status === "connecting" && <p>Подключение и чтение данных…</p>}

                {wallet.status === "connected" && (
                    <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.5rem" }}>
                        <div>
                            <span style={{ opacity: 0.7 }}>Адрес:</span>{" "}
                            <span>{shortAddress}</span>
                        </div>
                        <div>
                            <span style={{ opacity: 0.7 }}>ETH баланс:</span>{" "}
                            <span>{wallet.balanceEth} ETH</span>
                        </div>
                        <div>
                            <span style={{ opacity: 0.7 }}>ChainId:</span>{" "}
                            <span>{wallet.chainId}</span>
                        </div>

                        {isWrongNetwork && (
                            <p style={{ color: "#f97316", marginTop: "0.5rem" }}>
                                Внимание: пример рассчитан на Ethereum mainnet (chainId{" "}
                                {EXPECTED_CHAIN_ID}).
                            </p>
                        )}

                        {/* Блок с информацией о токене */}
                        <div
                            style={{
                                marginTop: "1rem",
                                padding: "0.75rem 1rem",
                                borderRadius: "12px",
                                background: "#020617",
                                border: "1px solid #1e293b",
                            }}
                        >
                            <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
                                ERC-20 токен (USDC)
                            </h2>
                            <div>
                                <span style={{ opacity: 0.7 }}>Токен:</span>{" "}
                                <span>{wallet.tokenSymbol ?? "—"}</span>
                            </div>
                            <div>
                                <span style={{ opacity: 0.7 }}>Баланс токена:</span>{" "}
                                <span>
                  {wallet.tokenBalance
                      ? `${wallet.tokenBalance} ${wallet.tokenSymbol}`
                      : "—"}
                </span>
                            </div>
                        </div>
                    </div>
                )}

                {wallet.status === "error" && (
                    <p style={{ color: "#f97316", marginTop: "0.5rem" }}>
                        Ошибка: {wallet.error}
                    </p>
                )}

                <p style={{ marginTop: "1.5rem", fontSize: "0.875rem", opacity: 0.7 }}>
                    Пример читает публичные данные: ETH баланс и баланс ERC‑20 (USDC) на
                    Ethereum mainnet. Транзакции не выполняются.
                </p>
            </div>
        </div>
    );
}

export default App;
