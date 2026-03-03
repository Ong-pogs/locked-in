import type { Course, Lesson } from '@/types';

export const MOCK_COURSES: Course[] = [
  {
    id: 'solana-fundamentals',
    title: 'Solana Fundamentals',
    description:
      'Learn the core concepts of the Solana blockchain — accounts, transactions, programs, and the runtime that makes it all tick.',
    totalLessons: 5,
    completedLessons: 0,
    difficulty: 'beginner',
    category: 'solana',
    imageUrl: null,
  },
  {
    id: 'anchor-dev',
    title: 'Anchor Development',
    description:
      'Build Solana programs using the Anchor framework — IDLs, accounts, instructions, and testing your on-chain code.',
    totalLessons: 3,
    completedLessons: 0,
    difficulty: 'intermediate',
    category: 'solana',
    imageUrl: null,
  },
  {
    id: 'rust-solana',
    title: 'Rust for Solana',
    description:
      'Learn the Rust fundamentals needed for Solana development — ownership, borrowing, structs, enums, and error handling.',
    totalLessons: 3,
    completedLessons: 0,
    difficulty: 'beginner',
    category: 'rust',
    imageUrl: null,
  },
  {
    id: 'defi-protocols',
    title: 'DeFi Protocols',
    description:
      'Understand decentralized finance protocols — AMMs, lending, yield farming, and how they work on Solana.',
    totalLessons: 3,
    completedLessons: 0,
    difficulty: 'intermediate',
    category: 'defi',
    imageUrl: null,
  },
];

export const MOCK_LESSONS: Record<string, Lesson[]> = {
  'solana-fundamentals': [
    {
      id: 'sf-1',
      courseId: 'solana-fundamentals',
      title: 'What is Solana?',
      order: 1,
      content:
        'Solana is a high-performance blockchain designed for decentralized applications and crypto-currencies. It can process thousands of transactions per second with sub-second finality, making it one of the fastest blockchains in existence.\n\nUnlike Ethereum which uses a global state machine, Solana uses a unique combination of Proof of History (PoH) and Proof of Stake (PoS) to achieve consensus. Proof of History creates a historical record that proves events occurred at a specific moment in time, acting as a cryptographic clock for the network.\n\nSolana was founded by Anatoly Yakovenko in 2017 and launched its mainnet beta in March 2020. The native token is SOL, which is used for transaction fees and staking.',
      questions: [
        {
          id: 'sf-1-q1',
          type: 'mcq',
          prompt: 'What consensus mechanisms does Solana combine?',
          options: [
            'Proof of Work and Proof of Stake',
            'Proof of History and Proof of Stake',
            'Delegated Proof of Stake and Proof of Authority',
            'Proof of History and Proof of Work',
          ],
          correctAnswer: 'Proof of History and Proof of Stake',
        },
        {
          id: 'sf-1-q2',
          type: 'short_text',
          prompt: 'What is the name of Solana\'s native token?',
          correctAnswer: 'SOL',
        },
      ],
    },
    {
      id: 'sf-2',
      courseId: 'solana-fundamentals',
      title: 'Accounts & the Account Model',
      order: 2,
      content:
        'Everything on Solana is an account. Accounts are the fundamental data storage primitive — they hold both data and SOL balances. Each account has an address (a 32-byte public key), a lamport balance, an owner program, and a data field.\n\nThere are three main types of accounts: data accounts that store arbitrary data, program accounts that contain executable code, and native accounts used by built-in system programs. Data accounts are further split into system-owned accounts and Program Derived Addresses (PDAs).\n\nUnlike Ethereum where smart contracts have their own storage, Solana programs are stateless. All state is stored in separate accounts that are passed to the program during execution. This separation of code and state is a key architectural difference.',
      questions: [
        {
          id: 'sf-2-q1',
          type: 'mcq',
          prompt: 'How large is a Solana account address?',
          options: ['16 bytes', '20 bytes', '32 bytes', '64 bytes'],
          correctAnswer: '32 bytes',
        },
        {
          id: 'sf-2-q2',
          type: 'mcq',
          prompt: 'What is a key difference between Solana programs and Ethereum smart contracts?',
          options: [
            'Solana programs are written in JavaScript',
            'Solana programs are stateless — state lives in separate accounts',
            'Solana programs cannot interact with other programs',
            'Solana programs run on a virtual machine',
          ],
          correctAnswer:
            'Solana programs are stateless — state lives in separate accounts',
        },
        {
          id: 'sf-2-q3',
          type: 'short_text',
          prompt: 'What are accounts that derive their address from a program called? (abbreviation)',
          correctAnswer: 'PDA',
        },
      ],
    },
    {
      id: 'sf-3',
      courseId: 'solana-fundamentals',
      title: 'Transactions & Instructions',
      order: 3,
      content:
        'Transactions are the way users interact with the Solana network. A transaction is a bundle of one or more instructions, each targeting a specific on-chain program. Transactions are atomic — either all instructions succeed or none of them do.\n\nEach instruction specifies: the program to call, the accounts it needs to read or write, and an instruction data payload. A transaction also includes a recent blockhash (to prevent replay attacks) and one or more signatures from the accounts that authorize the transaction.\n\nSolana transactions have a size limit of 1232 bytes. Transaction fees on Solana are deterministic and based on the number of signatures required, not on computational complexity like Ethereum gas fees. The base fee is 5000 lamports per signature (0.000005 SOL).',
      questions: [
        {
          id: 'sf-3-q1',
          type: 'mcq',
          prompt: 'What happens if one instruction in a Solana transaction fails?',
          options: [
            'Only that instruction is reverted',
            'The entire transaction fails — all instructions are reverted',
            'The remaining instructions still execute',
            'The transaction is retried automatically',
          ],
          correctAnswer:
            'The entire transaction fails — all instructions are reverted',
        },
        {
          id: 'sf-3-q2',
          type: 'short_text',
          prompt: 'What is the maximum size of a Solana transaction in bytes?',
          correctAnswer: '1232',
        },
        {
          id: 'sf-3-q3',
          type: 'mcq',
          prompt: 'Why does a Solana transaction include a recent blockhash?',
          options: [
            'To calculate the transaction fee',
            'To prevent replay attacks',
            'To determine which validator processes it',
            'To encrypt the transaction data',
          ],
          correctAnswer: 'To prevent replay attacks',
        },
      ],
    },
    {
      id: 'sf-4',
      courseId: 'solana-fundamentals',
      title: 'Programs & the Runtime',
      order: 4,
      content:
        'Programs on Solana are the equivalent of smart contracts on other blockchains. They are compiled to BPF (Berkeley Packet Filter) bytecode and deployed to the network. Programs are stateless and process instructions by reading from and writing to accounts passed in by the caller.\n\nSolana has several built-in native programs: the System Program (creates accounts and transfers SOL), the Token Program (manages SPL tokens), and the Associated Token Account Program (creates deterministic token accounts). Most DeFi and NFT applications build on top of these native programs.\n\nThe Solana runtime enforces strict rules: programs can only modify accounts they own, accounts must have enough lamports to be rent-exempt, and cross-program invocations (CPIs) allow programs to call other programs while maintaining security guarantees.',
      questions: [
        {
          id: 'sf-4-q1',
          type: 'mcq',
          prompt: 'What bytecode format do Solana programs compile to?',
          options: ['EVM bytecode', 'WebAssembly', 'BPF bytecode', 'JVM bytecode'],
          correctAnswer: 'BPF bytecode',
        },
        {
          id: 'sf-4-q2',
          type: 'short_text',
          prompt: 'What is the name of the mechanism that allows Solana programs to call other programs? (abbreviation)',
          correctAnswer: 'CPI',
        },
      ],
    },
    {
      id: 'sf-5',
      courseId: 'solana-fundamentals',
      title: 'Wallets & Keypairs',
      order: 5,
      content:
        'A Solana wallet is fundamentally a keypair — a public key (your address) and a private key (your secret). The public key is a 32-byte Ed25519 key that serves as your on-chain identity. The private key is used to sign transactions and should never be shared.\n\nWallets can be generated from a seed phrase (also called a mnemonic), which is typically 12 or 24 words following the BIP-39 standard. This seed phrase can deterministically generate multiple keypairs using derivation paths, allowing one backup phrase to control many accounts.\n\nPopular Solana wallets include Phantom, Solflare, and Backpack. For developers, the Solana CLI provides a file-system wallet, and the @solana/web3.js library offers programmatic keypair generation and transaction signing.',
      questions: [
        {
          id: 'sf-5-q1',
          type: 'mcq',
          prompt: 'What cryptographic curve does Solana use for keypairs?',
          options: ['secp256k1', 'Ed25519', 'P-256', 'Curve25519'],
          correctAnswer: 'Ed25519',
        },
        {
          id: 'sf-5-q2',
          type: 'short_text',
          prompt: 'How many words is a standard Solana seed phrase? (pick either common length)',
          correctAnswer: '12',
        },
        {
          id: 'sf-5-q3',
          type: 'mcq',
          prompt: 'Which of these is NOT a popular Solana wallet?',
          options: ['Phantom', 'MetaMask', 'Solflare', 'Backpack'],
          correctAnswer: 'MetaMask',
        },
      ],
    },
  ],

  'anchor-dev': [
    {
      id: 'ad-1',
      courseId: 'anchor-dev',
      title: 'What is Anchor?',
      order: 1,
      content:
        'Anchor is a framework for Solana program development that provides a set of developer tools for writing, testing, and deploying programs. It abstracts away much of the boilerplate required for raw Solana development using the Rust-based Solana SDK.\n\nAnchor uses an Interface Definition Language (IDL) to describe your program\'s instructions and accounts. The IDL is auto-generated from your Rust code and used by clients to interact with the program. Think of it like an ABI in Ethereum.\n\nThe framework provides macros like #[program], #[derive(Accounts)], and #[account] that generate the serialization, deserialization, and validation code you would otherwise write by hand.',
      questions: [
        {
          id: 'ad-1-q1',
          type: 'mcq',
          prompt: 'What does Anchor use to describe a program\'s interface?',
          options: [
            'ABI (Application Binary Interface)',
            'IDL (Interface Definition Language)',
            'JSON Schema',
            'Protocol Buffers',
          ],
          correctAnswer: 'IDL (Interface Definition Language)',
        },
        {
          id: 'ad-1-q2',
          type: 'short_text',
          prompt: 'What Rust attribute macro marks the main module of an Anchor program?',
          correctAnswer: '#[program]',
        },
      ],
    },
    {
      id: 'ad-2',
      courseId: 'anchor-dev',
      title: 'Accounts & Constraints',
      order: 2,
      content:
        'In Anchor, every instruction handler receives a context (Context<T>) where T is a struct that derives the Accounts trait. Each field in this struct represents an account the instruction needs to read or write.\n\nAnchor provides constraint attributes like #[account(init, payer = user, space = 8 + 32)] to declare how accounts should be validated. The init constraint creates and initializes a new account, mut marks an account as mutable, and has_one checks ownership relationships.\n\nProgram Derived Addresses (PDAs) are commonly used as accounts with deterministic addresses. Anchor makes creating PDAs easy with seeds and bump constraints: #[account(seeds = [b"vault", user.key().as_ref()], bump)].',
      questions: [
        {
          id: 'ad-2-q1',
          type: 'mcq',
          prompt: 'What does the #[account(init)] constraint do?',
          options: [
            'Initializes a variable in memory',
            'Creates and initializes a new on-chain account',
            'Imports an existing account',
            'Deletes an account',
          ],
          correctAnswer: 'Creates and initializes a new on-chain account',
        },
        {
          id: 'ad-2-q2',
          type: 'short_text',
          prompt: 'What type wraps the accounts struct in an Anchor instruction handler?',
          correctAnswer: 'Context',
        },
      ],
    },
    {
      id: 'ad-3',
      courseId: 'anchor-dev',
      title: 'Testing with Anchor',
      order: 3,
      content:
        'Anchor includes a built-in testing framework that lets you write integration tests in TypeScript. Tests run against a local Solana validator (solana-test-validator) or Anchor\'s built-in BankRun environment.\n\nThe anchor test command compiles your program, deploys it to localnet, and runs your TypeScript test suite. Tests use the @coral-xyz/anchor library to create a Provider (connection + wallet) and a Program instance that maps to your IDL.\n\nYou call program methods like: await program.methods.initialize().accounts({ myAccount: pda }).rpc(). Anchor auto-serializes arguments and deserializes return values based on the IDL. You can also use program.account.myAccount.fetch(pda) to read account data.',
      questions: [
        {
          id: 'ad-3-q1',
          type: 'mcq',
          prompt: 'What command compiles, deploys, and runs Anchor tests?',
          options: [
            'anchor build',
            'anchor deploy',
            'anchor test',
            'anchor run',
          ],
          correctAnswer: 'anchor test',
        },
        {
          id: 'ad-3-q2',
          type: 'short_text',
          prompt: 'What method on a Program instance sends a transaction for an instruction?',
          correctAnswer: 'rpc',
        },
      ],
    },
  ],

  'rust-solana': [
    {
      id: 'rs-1',
      courseId: 'rust-solana',
      title: 'Ownership & Borrowing',
      order: 1,
      content:
        'Rust\'s ownership system is its most distinctive feature. Every value in Rust has a single owner, and when the owner goes out of scope the value is dropped (freed). This eliminates the need for a garbage collector.\n\nBorrowing lets you reference a value without taking ownership. There are two types: immutable references (&T) and mutable references (&mut T). You can have either one mutable reference OR any number of immutable references at a time — never both.\n\nThis system prevents data races at compile time and is key to writing safe, concurrent Solana programs. When you see errors like "value moved here" or "cannot borrow as mutable", the compiler is enforcing these ownership rules.',
      questions: [
        {
          id: 'rs-1-q1',
          type: 'mcq',
          prompt: 'How many mutable references to a value can exist at the same time?',
          options: ['Zero', 'One', 'Two', 'Unlimited'],
          correctAnswer: 'One',
        },
        {
          id: 'rs-1-q2',
          type: 'short_text',
          prompt: 'What symbol denotes an immutable reference in Rust?',
          correctAnswer: '&',
        },
      ],
    },
    {
      id: 'rs-2',
      courseId: 'rust-solana',
      title: 'Structs & Enums',
      order: 2,
      content:
        'Structs are Rust\'s way of creating custom data types by grouping related fields together. They are heavily used in Solana programs to define account data. You define a struct with the struct keyword and can add methods using impl blocks.\n\nEnums in Rust are more powerful than in most languages — each variant can hold different data. This makes them perfect for modeling instruction types or state machines in Solana programs. The match keyword lets you exhaustively handle every variant.\n\nDeriving traits like Clone, Debug, and BorshSerialize/BorshDeserialize is essential for Solana. Borsh (Binary Object Representation Serializer for Hashing) is the serialization format used by Solana programs to encode/decode account data.',
      questions: [
        {
          id: 'rs-2-q1',
          type: 'mcq',
          prompt: 'What serialization format does Solana use for account data?',
          options: ['JSON', 'MessagePack', 'Borsh', 'Protobuf'],
          correctAnswer: 'Borsh',
        },
        {
          id: 'rs-2-q2',
          type: 'short_text',
          prompt: 'What keyword is used to add methods to a struct in Rust?',
          correctAnswer: 'impl',
        },
      ],
    },
    {
      id: 'rs-3',
      courseId: 'rust-solana',
      title: 'Error Handling',
      order: 3,
      content:
        'Rust uses the Result<T, E> type for error handling instead of exceptions. A Result is either Ok(value) on success or Err(error) on failure. The ? operator propagates errors up the call stack automatically.\n\nIn Solana programs, errors are returned as ProgramError or custom error enums. Anchor provides the #[error_code] macro to define custom errors with messages: #[error_code] enum MyError { #[msg("Insufficient funds")] InsufficientFunds }.\n\nThe require! macro in Anchor is a convenient way to validate conditions: require!(amount > 0, MyError::InsufficientFunds). This replaces verbose if/else error returns and makes your code more readable.',
      questions: [
        {
          id: 'rs-3-q1',
          type: 'mcq',
          prompt: 'What operator propagates errors automatically in Rust?',
          options: ['!', '?', '&', '::'],
          correctAnswer: '?',
        },
        {
          id: 'rs-3-q2',
          type: 'short_text',
          prompt: 'What Anchor macro is used to validate a condition and return an error?',
          correctAnswer: 'require!',
        },
      ],
    },
  ],

  'defi-protocols': [
    {
      id: 'dp-1',
      courseId: 'defi-protocols',
      title: 'Automated Market Makers',
      order: 1,
      content:
        'Automated Market Makers (AMMs) are the backbone of decentralized exchanges. Instead of matching buy and sell orders like a traditional exchange, AMMs use liquidity pools and mathematical formulas to determine token prices.\n\nThe most common formula is the constant product formula: x * y = k, where x and y are the reserves of two tokens. When you swap token A for token B, you add A to the pool and remove B, maintaining the constant k. This creates a price curve.\n\nOn Solana, major AMMs include Raydium (which combines AMM with an order book), Orca (known for concentrated liquidity), and Jupiter (a DEX aggregator that routes across multiple AMMs for the best price).',
      questions: [
        {
          id: 'dp-1-q1',
          type: 'mcq',
          prompt: 'What is the constant product formula used by AMMs?',
          options: ['x + y = k', 'x * y = k', 'x / y = k', 'x ^ y = k'],
          correctAnswer: 'x * y = k',
        },
        {
          id: 'dp-1-q2',
          type: 'short_text',
          prompt: 'What Solana protocol is known as a DEX aggregator?',
          correctAnswer: 'Jupiter',
        },
      ],
    },
    {
      id: 'dp-2',
      courseId: 'defi-protocols',
      title: 'Lending & Borrowing',
      order: 2,
      content:
        'Lending protocols allow users to deposit assets and earn interest, while borrowers can take loans against their collateral. The interest rates are typically determined algorithmically based on supply and demand (utilization rate).\n\nOver-collateralization is key: borrowers must deposit more value than they borrow. If the collateral value drops below a threshold (the liquidation ratio), anyone can liquidate the position by repaying the loan and claiming the discounted collateral.\n\nOn Solana, major lending protocols include Solend, MarginFi, and Kamino. These protocols use oracle price feeds (like Pyth or Switchboard) to track real-time asset prices for collateral valuation and liquidation triggers.',
      questions: [
        {
          id: 'dp-2-q1',
          type: 'mcq',
          prompt: 'What happens when a borrower\'s collateral drops below the liquidation ratio?',
          options: [
            'Nothing, the loan continues',
            'The protocol automatically adds more collateral',
            'Anyone can liquidate the position',
            'The interest rate is reduced',
          ],
          correctAnswer: 'Anyone can liquidate the position',
        },
        {
          id: 'dp-2-q2',
          type: 'short_text',
          prompt: 'What Solana oracle provides real-time price feeds for DeFi protocols?',
          correctAnswer: 'Pyth',
        },
      ],
    },
    {
      id: 'dp-3',
      courseId: 'defi-protocols',
      title: 'Yield Farming & Staking',
      order: 3,
      content:
        'Yield farming is the practice of moving assets between different DeFi protocols to maximize returns. Users provide liquidity to pools and earn trading fees plus additional token rewards (liquidity mining). The combined return is expressed as APY (Annual Percentage Yield).\n\nLiquid staking lets you stake SOL while maintaining liquidity. Protocols like Marinade (mSOL) and Jito (jitoSOL) give you a derivative token that represents your staked SOL plus accumulated rewards. You can use these tokens in other DeFi protocols.\n\nImpermanent loss is a key risk in yield farming. It occurs when the price ratio of your deposited tokens changes compared to when you entered the pool. The larger the price divergence, the greater the impermanent loss relative to simply holding the tokens.',
      questions: [
        {
          id: 'dp-3-q1',
          type: 'mcq',
          prompt: 'What is impermanent loss?',
          options: [
            'A permanent reduction in token supply',
            'Loss from price divergence of pooled tokens vs holding',
            'Transaction fees paid to validators',
            'Loss from failed transactions',
          ],
          correctAnswer: 'Loss from price divergence of pooled tokens vs holding',
        },
        {
          id: 'dp-3-q2',
          type: 'short_text',
          prompt: 'What does APY stand for?',
          correctAnswer: 'Annual Percentage Yield',
        },
      ],
    },
  ],
};
