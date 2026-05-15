require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { ApolloServer, gql } = require('apollo-server-express');

// 1. GLOBAL CONNECTION CACHE
// Optimized for Vercel Serverless to prevent "Buffering Timed Out"
let isConnected = false;

async function connectDB() {
    if (isConnected && mongoose.connection.readyState === 1) {
        return;
    }

    // Vercel Integration uses MONGODB_URI by default
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI; 
    
    if (!uri) {
        console.error("❌ MONGO_URI is missing from environment variables!");
        return;
    }

    try {
        // REMOVED: useNewUrlParser and useUnifiedTopology (No longer supported in new drivers)
        const db = await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 5000, 
        });
        isConnected = db.connections[0].readyState === 1;
        console.log("✅ MongoDB Connected");
    } catch (error) {
        console.error("❌ MongoDB Connection Error:", error);
    }
}

const app = express();
app.use(express.json());

// 2. MONGOOSE MODELS
const Player = mongoose.models.Player || mongoose.model('Player', new mongoose.Schema({
    roblox: { type: String, unique: true },
    created: { type: String, default: () => new Date().toISOString() },
    cash: { type: Number, default: 0 },
    inventory: [String],
    permissions: [{ name: String, source: String, canManage: Boolean }],
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' },
    license: { type: mongoose.Schema.Types.ObjectId, ref: 'License' }
}));

const License = mongoose.models.License || mongoose.model('License', new mongoose.Schema({
    created: { type: String, default: () => new Date().toISOString() },
    suspendedUntil: String,
    hasTheory: { type: Boolean, default: false },
    endorsements: [String],
    categories: [{ type: { type: String }, issued: String }]
}));

const Organisation = mongoose.models.Organisation || mongoose.model('Organisation', new mongoose.Schema({
    name: String,
    groupId: String,
    created: String,
    discoverable: Boolean,
    type: String,
    tag: String,
    customPermissions: [String],
    roleSet: [{ role: String, salary: Number, permissions: [String] }],
    bankAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' }
}));

const Vehicle = mongoose.models.Vehicle || mongoose.model('Vehicle', new mongoose.Schema({
    numberPlate: { type: String, unique: true },
    make: String,
    model: String,
    year: Number,
    colour: String,
    inventory: [String],
    created: String,
    player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
    org: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation' },
    property: { type: mongoose.Schema.Types.ObjectId, ref: 'Property' }
}));

const BankAccount = mongoose.models.BankAccount || mongoose.model('BankAccount', new mongoose.Schema({
    balance: { type: Number, default: 0 },
    player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
    organisation: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation' }
}));

const Property = mongoose.models.Property || mongoose.model('Property', new mongoose.Schema({
    location: String,
    active: Boolean,
    inventory: [String],
    player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
    org: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation' },
    created: String
}));

const Record = mongoose.models.Record || mongoose.model('Record', new mongoose.Schema({
    created: { type: String, default: () => new Date().toISOString() },
    type: String,
    issuer: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
    charges: [{ name: String, time: Number, payment: Number }]
}));

// 3. GRAPHQL SCHEMA
const typeDefs = gql`
  scalar ObjectID
  input CreateFlagInput { expires: String, reason: String, playerSubject: ObjectID, vehicleSubject: ObjectID, issuer: ObjectID }
  input CreateOrganisationInput { name: String, groupId: String, type: String, tag: String }
  input UpdatePlayerInput { cash: Int, inventory: [String] }
  input CreatePropertyInput { location: String, player: ObjectID, org: ObjectID }
  input CreateRecordInput { type: String, issuer: ObjectID, subject: ObjectID, charges: [ChargeInput] }
  input ChargeInput { name: String, time: Int, payment: Int }
  input CreateVehicleInput { numberPlate: String, make: String, model: String, year: Int, player: ObjectID, org: ObjectID }

  type Charge { name: String, time: Int, payment: Int }
  type RoleSet { role: String, salary: Int, permissions: [String] }
  type Permission { name: String, source: String, canManage: Boolean }
  type Account { id: ObjectID, balance: Int }
  
  type Player {
    id: ObjectID, created: String, roblox: String, cash: Int, inventory: [String]
    account: Account, permissions: [Permission], properties: [Property], vehicles: [Vehicle], license: License
  }

  type Organisation {
    id: ObjectID, name: String, groupId: String, created: String, discoverable: Boolean
    type: String, tag: String, customPermissions: [String], roleSet: [RoleSet], bankAccount: Account
  }

  type Vehicle {
    id: ObjectID, created: String, numberPlate: String, colour: String, make: String, model: String
    year: Int, inventory: [String], player: Player, org: Organisation, property: Property
  }

  type Property { id: ObjectID, created: String, location: String, active: Boolean, inventory: [String], player: Player, org: Organisation }
  type Record { id: ObjectID, created: String, type: String, issuer: Player, subject: Player, charges: [Charge] }
  type RecordConnection { records: [Record], total: Int }
  type License { id: ObjectID, created: String, suspendedUntil: String, hasTheory: Boolean, endorsements: [String], categories: [LicenseCategory] }
  type LicenseCategory { type: String, issued: String }

  type Query {
    player(id: ObjectID, roblox: String, upsert: Boolean): Player
    organisation(id: ObjectID, name: String, group: String): Organisation
    vehicle(id: ObjectID, numberPlate: String): Vehicle
    property(id: ObjectID!): Property
    records(subject: ObjectID, type: String, take: Int, skip: Int): RecordConnection
    bankAccount(id: ObjectID!): Account
  }

  type Mutation {
    createOrganisation(createOrganisationInput: CreateOrganisationInput!): Organisation
    updatePlayer(id: ObjectID!, updatePlayerInput: UpdatePlayerInput!): Player
    createVehicle(createVehicleInput: CreateVehicleInput!): Vehicle
    createRecord(createRecordInput: CreateRecordInput!): Record
    createProperty(createPropertyInput: CreatePropertyInput!): Property
    sellProperty(id: ObjectID!): Boolean
  }
`;

const resolvers = {
    Query: {
        player: async (_, { id, roblox }) => {
            // 1. Try to find the player
            let p = id ? await Player.findById(id) : await Player.findOne({ roblox });

            // 2. If the player doesn't exist, create them AND their sub-data immediately
            if (!p && roblox) {
                console.log(`🆕 Auto-creating record for new player: ${roblox}`);
                
                const newAcc = await BankAccount.create({ balance: 1000 });
                const newLic = await License.create({ hasTheory: false });

                p = await Player.create({ 
                    roblox: roblox, 
                    cash: 500, 
                    account: newAcc._id, 
                    license: newLic._id,
                    permissions: [],
                    inventory: [],
                    properties: [], 
                    vehicles: []    
                });
            }

            if (!p) return null;

            // 3. Fetch full data
            const data = await Player.findById(p._id).populate('account license properties vehicles');
            if (!data) return null;

            // THE FIX: Map _id to id for the main player and nested objects
            return {
                ...data._doc,
                id: data._id.toString(),
                account: data.account ? { ...data.account._doc, id: data.account._id.toString() } : null,
                license: data.license ? { ...data.license._doc, id: data.license._id.toString() } : null,
                // Map properties and vehicles arrays if they exist
                properties: data.properties.map(prop => ({ ...prop._doc, id: prop._id.toString() })),
                vehicles: data.vehicles.map(vh => ({ ...vh._doc, id: vh._id.toString() }))
            };
        },

        organisation: async (_, { id, name, group }) => {
            const query = {};
            if (id) query._id = id;
            if (name) query.name = name;
            if (group) query.groupId = group;

            const org = await Organisation.findOne(query).populate('bankAccount');
            if (!org) return null;

            return {
                ...org._doc,
                id: org._id.toString(),
                bankAccount: org.bankAccount ? { ...org.bankAccount._doc, id: org.bankAccount._id.toString() } : null
            };
        },

        vehicle: async (_, { id, numberPlate }) => {
            const v = await Vehicle.findOne(id ? { _id: id } : { numberPlate }).populate('player property org');
            if (!v) return null;

            return {
                ...v._doc,
                id: v._id.toString()
            };
        },

        records: async (_, { subject, type, take, skip }) => {
            const query = { subject };
            if (type) query.type = type;
            const items = await Record.find(query).limit(take || 10).skip(skip || 0).populate('issuer subject');
            const total = await Record.countDocuments(query);
            
            return { 
                records: items.map(item => ({ ...item._doc, id: item._id.toString() })), 
                total 
            };
        }
    },

    Mutation: {
        updatePlayer: async (_, { id, updatePlayerInput }) => {
            const data = await Player.findByIdAndUpdate(
                id, 
                { $set: updatePlayerInput }, 
                { new: true }
            ).populate('account license properties vehicles');
            if (!data) return null;
            return { ...data._doc, id: data._id.toString() };
        },

        createProperty: async (_, { createPropertyInput }) => {
            const p = await Property.create({ 
                ...createPropertyInput, 
                created: new Date().toISOString(), 
                active: true,
                inventory: []
            });
            return { ...p._doc, id: p._id.toString() };
        },

        sellProperty: async (_, { id }) => {
            await Property.findByIdAndDelete(id);
            return true;
        },

        createVehicle: async (_, { createVehicleInput }) => {
            const v = await Vehicle.create({ ...createVehicleInput, created: new Date().toISOString() });
            return { ...v._doc, id: v._id.toString() };
        },

        createRecord: async (_, { createRecordInput }) => {
            const r = await Record.create({ ...createRecordInput, created: new Date().toISOString() });
            const data = await Record.findById(r._id).populate('issuer subject');
            return { ...data._doc, id: data._id.toString() };
        }
    }
};

// 4. AUTH ROUTE
app.all('/auth/token', (req, res) => {
    res.status(200).json({
        token: "authenticated_session", 
        jobId: req.body.jobId || "studio"
    });
});

// 5. APOLLO SETUP
const server = new ApolloServer({ 
    typeDefs, 
    resolvers, 
    introspection: true,
    cache: "bounded"
});

// 6. MIDDLEWARE (Ensures DB & Apollo are ready)
let apolloStarted = false;
app.use(async (req, res, next) => {
    await connectDB();
    if (!apolloStarted) {
        await server.start();
        server.applyMiddleware({ app, path: '/graphql' });
        apolloStarted = true;
    }
    next();
});

// 7. STATUS PAGE
app.get('/status', async (req, res) => {
    await connectDB();
    const mongoState = mongoose.connection.readyState;
    const states = { 0: "🔴 Disconnected", 1: "🟢 Connected", 2: "🟡 Connecting", 3: "🟠 Disconnecting" };
    const statusColor = mongoState === 1 ? "#00ff88" : "#ff4444";

    res.send(`
        <html>
            <head><title>Northminster API Status</title><style>
                body { font-family: sans-serif; background: #0b0e14; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .card { background: #161b22; padding: 2rem; border-radius: 12px; border: 1px solid #30363d; text-align: center; width: 350px; }
                .status-dot { height: 15px; width: 15px; background-color: ${statusColor}; border-radius: 50%; display: inline-block; margin-right: 10px; box-shadow: 0 0 10px ${statusColor}; }
            </style></head>
            <body><div class="card">
                <h1>System Status</h1>
                <p><span class="status-dot"></span><strong>${states[mongoState]}</strong></p>
                <p style="color: #8b949e;">northminsterapi.jacobc.space</p>
                <a href="/status" style="color: #00ff88; text-decoration: none;">Refresh</a>
            </div></body>
        </html>
    `);
});

// This handles singular, plural, GET, and POST all at once
app.all(['/server/heartbeat', '/servers/heartbeat'], (req, res) => {
    res.status(200).json({ success: true });
});

// This stops the annoying "favicon.ico" 404 errors in your logs
app.get(['/favicon.ico', '/favicon.png'], (req, res) => res.status(204).end());

// LANDING PAGE
app.get('/', async (req, res) => {
    try {
        await connectDB();
        
        // Fetch Live Stats
        const [totalPlayers, totalVehicles, totalOrgs, wealthData] = await Promise.all([
            mongoose.model('Player').countDocuments(),
            mongoose.model('Vehicle').countDocuments(),
            mongoose.model('Organisation').countDocuments(),
            mongoose.model('Player').aggregate([{ $group: { _id: null, total: { $sum: "$cash" } } }])
        ]);

        const cityWealth = wealthData[0] ? wealthData[0].total : 0;
        const mongoState = mongoose.connection.readyState === 1;

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Northminster | Central API</title>
                <script src="https://cdn.tailwindcss.com"></script>
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&display=swap" rel="stylesheet">
                <style>
                    body { font-family: 'Inter', sans-serif; background-color: #030712; }
                    .glass { background: rgba(17, 24, 39, 0.7); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.1); }
                    .glow { box-shadow: 0 0 20px rgba(59, 130, 246, 0.5); }
                    .bg-gradient { background: radial-gradient(circle at top right, #1e293b, #030712); }
                </style>
            </head>
            <body class="bg-gradient text-gray-100 min-h-screen flex flex-col">

                <!-- Navigation -->
                <nav class="w-full max-w-7xl mx-auto px-6 py-6 flex justify-between items-center">
                    <div class="flex items-center space-x-2">
                        <div class="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-xl">N</div>
                        <span class="text-xl font-extrabold tracking-tighter uppercase">Northminster</span>
                    </div>
                    <div class="hidden md:flex space-x-8 text-sm font-medium text-gray-400">
                        <a href="/status" class="hover:text-white transition">Network Status</a>
                        <a href="/graphql" class="hover:text-white transition">Developer API</a>
                        <a href="#" class="hover:text-white transition">Documentation</a>
                    </div>
                    <a href="https://www.roblox.com" class="px-5 py-2 bg-white text-black rounded-full text-sm font-bold hover:bg-gray-200 transition">Enter City</a>
                </nav>

                <!-- Hero Section -->
                <main class="flex-grow flex flex-col items-center justify-center px-6 text-center">
                    <div class="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold mb-6 uppercase tracking-widest">
                        <span class="relative flex h-2 w-2">
                          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                          <span class="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                        </span>
                        <span>Systems Nominal</span>
                    </div>
                    
                    <h1 class="text-5xl md:text-7xl font-extrabold mb-4 tracking-tight">
                        Central Data <span class="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400 italic">Intelligence</span>
                    </h1>
                    <p class="text-gray-400 max-w-xl text-lg mb-12">
                        Powering the infrastructure of Northminster. Providing real-time synchronization between city services and the global registry.
                    </p>

                    <!-- Stats Grid -->
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-6 w-full max-w-6xl">
                        <div class="glass p-8 rounded-2xl text-left">
                            <span class="text-gray-500 text-xs font-bold uppercase tracking-widest">Citizens</span>
                            <div class="text-3xl font-bold mt-1">${totalPlayers.toLocaleString()}</div>
                        </div>
                        <div class="glass p-8 rounded-2xl text-left border-l-4 border-l-blue-500">
                            <span class="text-gray-500 text-xs font-bold uppercase tracking-widest">City Wealth</span>
                            <div class="text-3xl font-bold mt-1">£${cityWealth.toLocaleString()}</div>
                        </div>
                        <div class="glass p-8 rounded-2xl text-left">
                            <span class="text-gray-500 text-xs font-bold uppercase tracking-widest">Registered Vehicles</span>
                            <div class="text-3xl font-bold mt-1">${totalVehicles.toLocaleString()}</div>
                        </div>
                        <div class="glass p-8 rounded-2xl text-left">
                            <span class="text-gray-500 text-xs font-bold uppercase tracking-widest">Active Orgs</span>
                            <div class="text-3xl font-bold mt-1">${totalOrgs.toLocaleString()}</div>
                        </div>
                    </div>
                </main>

                <!-- Footer -->
                <footer class="w-full max-w-7xl mx-auto px-6 py-12 mt-12 border-t border-white/5 flex flex-col md:flex-row justify-between items-center text-gray-500 text-sm">
                    <p>&copy; 2026 Northminster Development. Powered by Apollo & MongoDB.</p>
                    <div class="flex space-x-6 mt-4 md:mt-0">
                        <span class="flex items-center">
                            <div class="w-2 h-2 rounded-full ${mongoState ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-red-500'} mr-2"></div>
                            Database: ${mongoState ? 'CONNECTED' : 'OFFLINE'}
                        </span>
                        <a href="/graphql" class="hover:text-white transition underline">Endpoint API</a>
                    </div>
                </footer>

            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send("Critical System Error: " + err.message);
    }
});

// 8. EXPORTS
module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    const PORT = 4000;
    app.listen(PORT, () => console.log(`🚀 Local at http://localhost:${PORT}`));
}