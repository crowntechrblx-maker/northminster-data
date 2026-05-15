require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { ApolloServer, gql } = require('apollo-server-express');

// 1. GLOBAL CONNECTION CACHE
let isConnected = false;
async function connectDB() {
    if (isConnected && mongoose.connection.readyState === 1) return;
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI; 
    if (!uri) return console.error("❌ MONGO_URI missing");
    try {
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
        isConnected = true;
        console.log("✅ MongoDB Connected");
    } catch (error) { console.error("❌ MongoDB Error:", error); }
}

const app = express();
app.use(express.json());

// 2. MONGOOSE MODELS
const Player = mongoose.models.Player || mongoose.model('Player', new mongoose.Schema({
    roblox: { type: String, unique: true, required: true },
    cash: { type: Number, default: 500 },
    inventory: [String],
    permissions: [{ name: String, source: String, canManage: Boolean }],
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' },
    license: { type: mongoose.Schema.Types.ObjectId, ref: 'License' },
    properties: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Property' }],
    vehicles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' }]
}));

const BankAccount = mongoose.models.BankAccount || mongoose.model('BankAccount', new mongoose.Schema({ balance: { type: Number, default: 1000 } }));
const License = mongoose.models.License || mongoose.model('License', new mongoose.Schema({ hasTheory: { type: Boolean, default: false }, categories: [{ type: { type: String }, issued: String }] }));
const Organisation = mongoose.models.Organisation || mongoose.model('Organisation', new mongoose.Schema({ name: String, groupId: String, discoverable: Boolean, bankAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' } }));
const Vehicle = mongoose.models.Vehicle || mongoose.model('Vehicle', new mongoose.Schema({ numberPlate: String, model: String }));
const Property = mongoose.models.Property || mongoose.model('Property', new mongoose.Schema({ location: String }));

// 3. ID MAPPING HELPER (Fixes the "Response missing ID mapping" error)
const mapId = (doc) => {
    if (!doc) return null;
    const obj = doc.toObject ? doc.toObject() : doc;
    obj.id = obj._id.toString();
    return obj;
};

// 4. GRAPHQL SCHEMA
const typeDefs = gql`
  scalar ObjectID
  scalar JSON

  type RoleSet {
    role: Int
    salary: Int
    permissions: [String]
  }

  type Account { id: ObjectID, balance: Int }

  type Organisation {
    id: ObjectID
    name: String
    groupId: String
    created: String
    discoverable: Boolean
    type: String
    tag: String
    customPermissions: [String]
    roleSet: [RoleSet]
    bankAccount: Account
  }

  type Player { 
    id: ObjectID, roblox: String, cash: Int, account: Account, properties: [Property], vehicles: [Vehicle] 
  }

  type Property { id: ObjectID, location: String }
  type Vehicle { id: ObjectID, model: String, numberPlate: String }

  type Query {
    # Added 'group' argument to match Roblox request
    player(roblox: String, upsert: Boolean): Player
    organisation(id: ObjectID, name: String, group: String): Organisation
    status: String
  }

  type Mutation {
    updatePlayer(id: ObjectID!, updatePlayerInput: UpdatePlayerInput!): Player
  }
  input UpdatePlayerInput { cash: Int, inventory: [String] }
`;


const resolvers = {
    Query: {
         player: async (_, { roblox, upsert }) => {
            await connectDB();
            let p = await Player.findOne({ roblox: String(roblox) });
            if (!p && upsert) {
                const acc = await BankAccount.create({ balance: 1000 });
                p = await Player.create({ roblox: String(roblox), account: acc._id, cash: 500 });
            }
            if (!p) return null;
            const data = await Player.findById(p._id).populate('account properties vehicles');
            return mapId(data);
        },
        organisation: async (_, { id, name, group }) => {
            await connectDB();
            const query = {};
            if (id) query._id = id;
            if (name) query.name = name;
            if (group) query.groupId = group; // Maps 'group' from Roblox to 'groupId' in Mongo

            const org = await Organisation.findOne(query).populate('bankAccount');
            if (!org) return null;

            // Map IDs so Roblox doesn't crash
            const formatted = mapId(org);
            if (formatted.bankAccount) {
                formatted.bankAccount = mapId(formatted.bankAccount);
            }
            
            return formatted;
        },

        organisations: async (_, { groups }) => {
            await connectDB();
            const list = await Organisation.find({ groupId: { $in: groups } }).populate('bankAccount');
            return list.map(mapId);
        },

        bankAccount: async (_, { id }) => {
            await connectDB();
            const acc = await BankAccount.findById(id);
            return acc ? mapId(acc) : null;
        }
        
    },
    Mutation: {
         updatePlayer: async (_, { id, updatePlayerInput }) => {
            await connectDB();
            const p = await Player.findByIdAndUpdate(id, { $set: updatePlayerInput }, { new: true });
            return mapId(p);
        }
    }
};

// 5. ROUTES
app.all('/auth/token', (req, res) => res.json({ token: "authenticated_session", jobId: req.body.jobId }));
app.all(['/server/heartbeat', '/servers/heartbeat'], (req, res) => res.json({ success: true }));

app.get('/status', async (req, res) => {
    await connectDB();
    const state = mongoose.connection.readyState === 1 ? "CONNECTED" : "DISCONNECTED";
    res.send(`Database: ${state}`);
});

// 6. PORTAL PAGE (BritSov Style)
app.get('/', async (req, res) => {
    await connectDB();
    const [players, vehicles, orgs] = await Promise.all([Player.countDocuments(), Vehicle.countDocuments(), Organisation.countDocuments()]);
    res.send(`
        <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Northminster | Central API</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&display=swap" rel="stylesheet">
        <style>body{font-family:'Inter',sans-serif;background-color:#030712;}.glass{background:rgba(17,24,39,0.7);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.1);}</style></head>
        <body class="text-gray-100 min-h-screen flex flex-col justify-center items-center px-6">
            <div class="w-full max-w-5xl text-center">
                <div class="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold mb-8 uppercase tracking-widest">
                    <span class="flex h-2 w-2 rounded-full bg-blue-500 animate-pulse"></span><span>API Systems Nominal</span>
                </div>
                <h1 class="text-6xl font-extrabold mb-6 tracking-tighter">Northminster <span class="italic text-blue-500">Registry</span></h1>
                <p class="text-gray-400 text-lg mb-12 max-w-2xl mx-auto">Central data synchronization powering the city of Northminster.</p>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
                    <div class="glass p-8 rounded-3xl"><span class="text-gray-500 text-xs font-bold uppercase">Citizens</span><div class="text-4xl font-bold mt-2">${players}</div></div>
                    <div class="glass p-8 rounded-3xl border-l-4 border-blue-500"><span class="text-gray-500 text-xs font-bold uppercase">Vehicles</span><div class="text-4xl font-bold mt-2">${vehicles}</div></div>
                    <div class="glass p-8 rounded-3xl"><span class="text-gray-500 text-xs font-bold uppercase">Organisations</span><div class="text-4xl font-bold mt-2">${orgs}</div></div>
                </div>
                <div class="mt-12 text-gray-600 text-sm">© 2026 Northminster Development. Database: ${mongoose.connection.readyState === 1 ? 'ONLINE' : 'OFFLINE'}</div>
            </div>
        </body></html>
    `);
});

// 7. APOLLO STARTUP
const server = new ApolloServer({ typeDefs, resolvers, introspection: true, cache: "bounded" });
let started = false;
app.use(async (req, res, next) => {
    if (!started) { await server.start(); server.applyMiddleware({ app, path: '/graphql' }); started = true; }
    next();
});

module.exports = app;
if (process.env.NODE_ENV !== 'production') app.listen(4000, () => console.log("🚀 Local: 4000"));