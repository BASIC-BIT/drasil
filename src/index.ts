import { Bot } from './Bot';

async function main() {
    const bot = new Bot();
    try {
        await bot.startBot();
    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
}

main(); 