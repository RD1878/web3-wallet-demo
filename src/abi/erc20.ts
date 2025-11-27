// src/abi/erc20.ts

// Human-readable ABI для чтения базовых данных ERC-20.
// Здесь только три функции, которые действительно нужны фронту на этом этапе.
export const erc20Abi = [
    // Возвращает баланс токена для указанного адреса.
    // Важно: это не "ETH баланс", а баланс конкретного токена.
    "function balanceOf(address owner) view returns (uint256)",

    // Сколько знаков после запятой используется в токене.
    // Например, у USDC — 6, у большинства других ERC-20 — 18.
    "function decimals() view returns (uint8)",

    // Короткий символ токена, вроде "USDC" или "DAI".
    "function symbol() view returns (string)",
];
