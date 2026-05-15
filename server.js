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
  }
`;

const resolvers = {
    Query: {
    // Inside your resolvers = { Query: { ... } }
player: async (_, { id, roblox }) => {
    // 1. Try to find the player
    let p = id ? await Player.findById(id) : await Player.findOne({ roblox });

    // 2. If the player doesn't exist, create them AND their sub-data immediately
    if (!p && roblox) {
        console.log(`🆕 Auto-creating record for new player: ${roblox}`);
        
        // Create the supporting documents first
        const newAcc = await BankAccount.create({ balance: 1000 });
        const newLic = await License.create({ hasTheory: false });

        // Create the player with empty arrays for properties/vehicles to prevent crashes
        p = await Player.create({ 
            roblox: roblox, 
            cash: 500, 
            account: newAcc._id, 
            license: newLic._id,
            permissions: [],
            inventory: [],
            properties: [], // CRITICAL: Prevents "index nil" in PropertyService
            vehicles: []    // CRITICAL: Prevents "index nil" in VehicleService
        });
    }

    // 3. Return the player (new or old) with all data attached
    if (!p) return null;
    return await Player.findById(p._id).populate('account license properties vehicles');
},
        organisation: async (_, { id, name, group }) => {
            const query = {};
            if (id) query._id = id;
            if (name) query.name = name;
            if (group) query.groupId = group;
            return await Organisation.findOne(query).populate('bankAccount');
        },
        vehicle: async (_, { id, numberPlate }) => {
            return await Vehicle.findOne(id ? { _id: id } : { numberPlate }).populate('player property org');
        },
        records: async (_, { subject, type, take, skip }) => {
            const query = { subject };
            if (type) query.type = type;
            const items = await Record.find(query).limit(take || 10).skip(skip || 0).populate('issuer subject');
            const total = await Record.countDocuments(query);
            return { records: items, total };
        }
    },
    Mutation: {
       // In your Mutation resolvers in server.js
updatePlayer: async (_, { id, updatePlayerInput }) => {
    return await Player.findByIdAndUpdate(
        id, 
        { $set: updatePlayerInput }, // Use $set to update only provided fields
        { new: true }
    ).populate('account license properties vehicles');
},
        createVehicle: async (_, { createVehicleInput }) => {
            return await Vehicle.create({ ...createVehicleInput, created: new Date().toISOString() });
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

// 8. EXPORTS
module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    const PORT = 4000;
    app.listen(PORT, () => console.log(`🚀 Local at http://localhost:${PORT}`));
}