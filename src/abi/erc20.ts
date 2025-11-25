// Human-readable ABI для чтения базовых данных ERC-20 из фронтенда.
// Здесь только то, что нужно фронту: баланс, decimals и символ токена.
export const erc20Abi = [
    "function balanceOf(address owner) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
];
