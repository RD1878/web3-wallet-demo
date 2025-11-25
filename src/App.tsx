import { useEffect, useState, useCallback } from "react";

// Импортируем из ethers v6:
// - BrowserProvider: обёртка вокруг window.ethereum (EIP-1193 провайдер)
// - JsonRpcSigner: тип для signer, который подписывает транзакции/сообщения
// - formatEther: утилита для перевода значения из Wei (целое число) в строку ETH (с плавающей точкой)
import { BrowserProvider, JsonRpcSigner, formatEther } from "ethers";

// Типы статуса подключения — удобно держать как union-тип
type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

// Описываем, какие данные хотим хранить про кошелёк в одном объекте состояния
interface WalletState {
    address: string | null;   // текущий адрес пользователя или null, если не подключен
    chainId: number | null;   // ID сети (1 для mainnet, 11155111 для Sepolia и т.д.)
    balanceEth: string | null; // баланс в ETH, приведённый к строке
    status: ConnectionState;  // текущий статус подключения
    error: string | null;     // текст ошибки для отображения в UI
}

function App() {
    const [wallet, setWallet] = useState<WalletState>({
        address: null,
        chainId: null,
        balanceEth: null,
        status: "disconnected",
        error: null,
    });
    const [provider, setProvider] = useState<BrowserProvider | null>(null);
    const [signer, setSigner] = useState<JsonRpcSigner | null>(null);

    // 1. На этапе монтирования компонента проверяем, есть ли window.ethereum
    //    и, если есть, создаём BrowserProvider.
    useEffect(() => {
        // window может быть undefined в SSR-сценариях, поэтому сначала проверяем тип
        if (typeof window !== "undefined" && (window as any).ethereum) {
            // Берём "сырой" EIP-1193 провайдер, который внедряет MetaMask (или другой кошелёк)
            const eth = (window as any).ethereum;

            // Создаём BrowserProvider — адаптер ethers поверх EIP-1193 провайдера
            const browserProvider = new BrowserProvider(eth);

            // Сохраняем его в состояние, чтобы использовать дальше
            setProvider(browserProvider);
        } else {
            // Если провайдер не найден, сразу устанавливаем статус ошибки,
            // чтобы в UI показать сообщение "Установите MetaMask"
            setWallet((prev) => ({
                ...prev,
                status: "error",
                error: "Кошелёк не найден. Установите MetaMask или совместимый wallet.",
            }));
        }
    }, []);

    // Хелпер для "очистки" состояния кошелька
    // useCallback, чтобы не создавать новую функцию на каждый рендер
    const resetWalletState = useCallback(() => {
        setWallet({
            address: null,
            chainId: null,
            balanceEth: null,
            status: "disconnected",
            error: null,
        });
        setSigner(null);
    }, []);

    // Основная функция подключения кошелька по кнопке "Подключить кошелёк"
    const connectWallet = useCallback(async () => {
        // Если провайдер ещё не инициализирован (например, не нашли window.ethereum),
        // не пытаемся подключаться и показываем ошибку
        if (!provider) {
            setWallet((prev) => ({
                ...prev,
                status: "error",
                error: "Провайдер не инициализирован (нет window.ethereum).",
            }));
            return;
        }

        try {
            // Переводим статус в "connecting", чтобы UI мог показать спиннер/текст "Подключение..."
            setWallet((prev) => ({ ...prev, status: "connecting", error: null }));

            // Достаём исходный EIP-1193 провайдер из window
            const eth = (window as any).ethereum;

            // Запрашиваем у пользователя доступ к аккаунтам.
            // Метод eth_requestAccounts:
            // - если пользователь уже дал доступ, вернёт массив адресов
            // - если нет, покажет всплывающее окно в MetaMask
            const accounts: string[] = await eth.request({
                method: "eth_requestAccounts",
            });

            // Если кошелёк вернул пустой массив, это значит, что ни один аккаунт
            // не был предоставлен сайту (редко, но лучше явно обработать)
            if (!accounts || accounts.length === 0) {
                throw new Error("Нет доступных аккаунтов");
            }

            // Берём первый аккаунт в качестве активного (стандартный сценарий)
            const userAddress = accounts[0];

            // Получаем signer для этого адреса.
            // Signer знает, как отправлять транзакции/подписывать сообщения
            // от имени этого пользователя (через кошелёк).
            const nextSigner = await provider.getSigner(userAddress);

            // Получаем информацию о сети:
            // - chainId: уникальный ID сети
            // - name и другие поля, если понадобятся позже
            const network = await provider.getNetwork();

            // Получаем баланс этого адреса в Wei (целое число, BigInt)
            const balanceWei = await provider.getBalance(userAddress);

            // formatEther переводит баланс из Wei в строку в ETH (с десятичной точкой)
            const balanceEth = formatEther(balanceWei);

            // Обновляем состояние:
            // - сохраняем signer
            // - выставляем адрес, chainId, отформатированный баланс и статус "connected"
            setSigner(nextSigner);
            setWallet({
                address: userAddress,
                chainId: Number(network.chainId), // приводим к number для удобства
                balanceEth,
                status: "connected",
                error: null,
            });
        } catch (error: any) {
            // Любая ошибка (например, пользователь нажал "Cancel" в MetaMask)
            // попадает сюда. Логируем в консоль для разработчика...
            console.error(error);

            // ...и обновляем состояние, чтобы показать человеку понятное сообщение.
            setWallet((prev) => ({
                ...prev,
                status: "error",
                error: error?.message ?? "Ошибка при подключении кошелька",
            }));
        }
    }, [provider]);

    // Подписка на события кошелька:
    // - accountsChanged: пользователь сменил аккаунт или отключил сайт
    // - chainChanged: пользователь сменил сеть (например, с mainnet на Sepolia)
    useEffect(() => {
        const eth = (window as any).ethereum;
        if (!eth) return; // если нет провайдера, подписываться не на что

        // Обработчик смены аккаунтов
        const handleAccountsChanged = (accounts: string[]) => {
            if (!accounts || accounts.length === 0) {
                // Сценарий: пользователь отключил сайт в MetaMask.
                // Мы сбрасываем состояние до "не подключено".
                resetWalletState();
            } else {
                // Сценарий: пользователь переключил аккаунт в кошельке.
                // Обычно dApp либо:
                // 1) обновляет состояние "вручную",
                // 2) либо переиспользует логику connectWallet, чтобы пересчитать всё.
                connectWallet();
            }
        };

        // Обработчик смены сети
        const handleChainChanged = (_chainIdHex: string) => {
            // MetaMask официально рекомендует перезагружать страницу
            // при смене сети, но для демо мы просто переиспользуем connectWallet,
            // чтобы прочитать новый chainId и баланс в новой сети.
            connectWallet();
        };

        // Подписываемся на события.
        // Важно: это API самого кошелька (EIP-1193), а не React.
        eth.on("accountsChanged", handleAccountsChanged);
        eth.on("chainChanged", handleChainChanged);

        // Возвращаем функцию очистки (unsubscribe), чтобы не плодить лишние подписки
        return () => {
            if (!eth.removeListener) return;

            eth.removeListener("accountsChanged", handleAccountsChanged);
            eth.removeListener("chainChanged", handleChainChanged);
        };
    }, [connectWallet, resetWalletState]);

    // Удобное представление "короткого адреса" для UI, чтобы не занимать всю ширину
    const shortAddress =
        wallet.address && `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`;

    // chainId, который мы "ожидаем" для этого приложения.
    // Здесь для примера — mainnet (1). В реальном dApp подставишь нужную сеть.
    const expectedChainId = 1;

    // Флаг, что пользователь сейчас в "не той" сети
    const isWrongNetwork =
        wallet.chainId !== null && wallet.chainId !== expectedChainId;

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
                    maxWidth: "480px",
                    boxShadow: "0 20px 30px rgba(0,0,0,0.4)",
                }}
            >
                <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>
                    Web3 Wallet Demo
                </h1>

                {/* Если провайдер не найден (нет MetaMask), показываем понятное сообщение */}
                {!provider && (
                    <p>
                        Кошелёк не найден. Пожалуйста, установите расширение MetaMask или
                        другой Ethereum‑кошелёк.
                    </p>
                )}

                {/* Стартовый экран: кошелёк есть, но подключение ещё не выполнено */}
                {provider && wallet.status === "disconnected" && (
                    <button
                        onClick={connectWallet}
                        style={{
                            padding: "0.75rem 1.5rem",
                            borderRadius: "999px",
                            border: "none",
                            cursor: "pointer",
                            background:
                                "linear-gradient(135deg, #4f46e5, #06b6d4)",
                            color: "white",
                            fontWeight: 600,
                        }}
                    >
                        Подключить кошелёк
                    </button>
                )}

                {/* В момент подключения показываем текст. Можно заменить на спиннер. */}
                {wallet.status === "connecting" && <p>Подключение кошелька…</p>}

                {/* Состояние, когда мы успешно подключились и уже знаем адрес/баланс/chainId */}
                {wallet.status === "connected" && (
                    <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.5rem" }}>
                        <div>
                            <span style={{ opacity: 0.7 }}>Адрес:</span>{" "}
                            <span>{shortAddress}</span>
                        </div>
                        <div>
                            <span style={{ opacity: 0.7 }}>Баланс:</span>{" "}
                            <span>{wallet.balanceEth} ETH</span>
                        </div>
                        <div>
                            <span style={{ opacity: 0.7 }}>ChainId:</span>{" "}
                            <span>{wallet.chainId}</span>
                        </div>
                        {/* Если сеть не та, мягко предупреждаем пользователя */}
                        {isWrongNetwork && (
                            <p style={{ color: "#f97316", marginTop: "0.5rem" }}>
                                Внимание: вы в другой сети. Ожидается chainId {expectedChainId}.
                            </p>
                        )}
                    </div>
                )}

                {/* Любая ошибка (нет кошелька, отказ доступа, и т.п.) показывается здесь */}
                {wallet.status === "error" && (
                    <p style={{ color: "#f97316", marginTop: "0.5rem" }}>
                        Ошибка: {wallet.error}
                    </p>
                )}

                {/* Небольшой поясняющий текст: важно подчёркивать пользователю,
            что сейчас dApp лишь читает публичные данные */}
                <p style={{ marginTop: "1.5rem", fontSize: "0.875rem", opacity: 0.7 }}>
                    Это демо только читает публичные данные вашего аккаунта и не выполняет
                    транзакций.
                </p>
            </div>
        </div>
    );
}

export default App;
