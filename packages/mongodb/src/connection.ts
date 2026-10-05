import mongoose from 'mongoose';

let connectionPromise: Promise<typeof mongoose> | null = null;
let isMock = false;

/** Conecta a MongoDB. Si no está disponible y MONGODB_MOCK=1, usa mock en memoria. */
export async function connectMongo(uri?: string): Promise<typeof mongoose> {
  const mongoUri = uri ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017/scraper';
  if (connectionPromise) return connectionPromise;

  // Mock mode para tests sin MongoDB real
  if (process.env.MONGODB_MOCK === '1') {
    isMock = true;
    console.log('[MONGO] modo MOCK activado (MONGODB_MOCK=1)');
    return mockMongoose();
  }

  try {
    connectionPromise = mongoose.connect(mongoUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    });
    await connectionPromise;
    mongoose.connection.on('error', (err) => console.error('[MONGO] error:', err.message));
    mongoose.connection.on('connected', () => console.log('[MONGO] conectado'));
    return connectionPromise;
  } catch (err) {
    if (process.env.MONGODB_MOCK === '1') {
      isMock = true;
      console.log('[MONGO] fallback a modo MOCK');
      return mockMongoose();
    }
    throw err;
  }
}

function mockMongoose(): typeof mongoose {
  // Mongoose mock mínimo para tests - evita conexión real
  const collections: Record<string, unknown> = {};

  const mock = {
    ...mongoose,
    connect: async () => mock,
    disconnect: async () => {},
    connection: {
      ...mongoose.connection,
      readyState: 1,
      on: () => {},
      collections,
    },
    model: (name: string, _schema: unknown) => {
      const collectionName = name.toLowerCase() + 's';
      if (!mock.connection.collections[collectionName]) {
        mock.connection.collections[collectionName] = {
          findOne: async () => null,
          find: () => ({
            sort: () => ({ limit: () => ({ exec: async () => [] }) }),
            exec: async () => [],
          }),
          create: async (doc: Record<string, unknown>) => ({ _id: new mongoose.Types.ObjectId(), ...doc, save: async () => {} }),
          findById: async () => null,
          findByIdAndUpdate: async () => null,
          deleteMany: async () => {},
        };
      }
      return {
        findOne: async () => null,
        find: () => ({
          sort: () => ({ limit: () => ({ exec: async () => [] }) }),
          exec: async () => [],
        }),
        create: async (doc: Record<string, unknown>) => ({ _id: new mongoose.Types.ObjectId(), ...doc, save: async () => {} }),
        findById: async () => null,
        findByIdAndUpdate: async () => null,
      };
    },
    Types: mongoose.Types,
    Schema: mongoose.Schema,
  };
  return mock as unknown as typeof mongoose;
}

export function isMongoMock(): boolean {
  return isMock;
}

export function getConnection() {
  return mongoose.connection;
}

export async function disconnectMongo(): Promise<void> {
  if (connectionPromise && !isMock) {
    await mongoose.disconnect();
    connectionPromise = null;
  }
}

export { mongoose };