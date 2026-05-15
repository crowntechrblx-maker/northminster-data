const { ApolloServer, gql } = require('apollo-server-express');
const express = require('express');
const mongoose = require('mongoose');

async function startServer() {
    const app = express();
    app.use(express.json());

    // 1. Database Connection
    // Replace with your actual MongoDB URI
    const MONGO_URI = 'mongodb+srv://robloxuser:DatabasePassword1234@cluster0.h3szqtc.mongodb.net/?appName=Cluster0';
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB");

    // 2. Mongoose Schemas & Models
    const PlayerSchema = new mongoose.Schema({
        roblox: { type: String, unique: true },
        created: { type: String, default: () => new Date().toISOString() },
        cash: { type: Number, default: 0 },
        inventory: [String],
        permissions: [{ name: String, source: String, canManage: Boolean }],
        account: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' }
    });
    const Player = mongoose.model('Player', PlayerSchema);

    const OrgSchema = new mongoose.Schema({
        name: String,
        groupId: String,
        created: String,
        discoverable: Boolean,
        type: String,
        tag: String,
        customPermissions: [String],
        roleSet: [{ role: String, salary: Number, permissions: [String] }],
        bankAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' }
    });
    const Organisation = mongoose.model('Organisation', OrgSchema);

    const VehicleSchema = new mongoose.Schema({
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
    });
    const Vehicle = mongoose.model('Vehicle', VehicleSchema);

    const BankAccount = mongoose.model('BankAccount', new mongoose.Schema({
        balance: { type: Number, default: 0 },
        player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
        organisation: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation' }
    }));

    const Property = mongoose.model('Property', new mongoose.Schema({
        location: String,
        active: Boolean,
        inventory: [String],
        player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
        org: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation' },
        created: String
    }));

    // 3. GraphQL Schema (The "Contract")
    const typeDefs = gql`
      scalar ObjectID

      # Inputs defined in your Roblox scripts
      input CreateFlagInput { expires: String, reason: String, playerSubject: ObjectID, vehicleSubject: ObjectID, issuer: ObjectID }
      input CreateMarkerInput { reason: String, vehicleSubject: ObjectID, issuer: ObjectID }
      input CreateOrganisationInput { name: String, groupId: String, type: String, tag: String }
      input UpdateOrganisationInput { id: ObjectID, discoverable: Boolean, tag: String }
      input UpdatePlayerInput { cash: Int, inventory: [String] }
      input CreatePropertyInput { location: String, player: ObjectID, org: ObjectID }
      input UpdatePropertyInput { id: ObjectID, active: Boolean, inventory: [String] }
      input CreateRecordInput { type: String, issuer: ObjectID, subject: ObjectID, charges: [ChargeInput] }
      input ChargeInput { name: String, time: Int, payment: Int }
      input CreateTransactionInput { from: ObjectID, to: ObjectID, amount: Int, type: String }
      input CreateVehicleInput { numberPlate: String, make: String, model: String, year: Int, player: ObjectID, org: ObjectID }
      input UpdateVehicleInput { id: ObjectID, colour: String, inventory: [String] }
      input CreateCmdrLogInput { command: String, userId: String }

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
        players(id: ObjectID): [Player]
        organisation(id: ObjectID, name: String, group: String): Organisation
        organisations(groups: [String!]!): [Organisation]
        vehicle(id: ObjectID, numberPlate: String): Vehicle
        vehicles(take: Int, skip: Int, player: ObjectID, org: ObjectID, property: ObjectID): VehicleConnection
        property(id: ObjectID!): Property
        records(subject: ObjectID, type: String, take: Int, skip: Int): RecordConnection
        bankAccount(id: ObjectID!): Account
      }

      type VehicleConnection { vehicles: [Vehicle], total: Int, makes: [MakeInfo] }
      type MakeInfo { name: String, models: [String] }

      type Mutation {
        createOrganisation(createOrganisationInput: CreateOrganisationInput!): Organisation
        updateOrganisation(updateOrganisationInput: UpdateOrganisationInput!): Organisation
        updatePlayer(id: ObjectID!, updatePlayerInput: UpdatePlayerInput!): Player
        createVehicle(createVehicleInput: CreateVehicleInput!): Vehicle
        updateVehicle(updateVehicleInput: UpdateVehicleInput!): Vehicle
        createProperty(createPropertyInput: CreatePropertyInput!): Property
        sellProperty(id: ObjectID!): Boolean
        createRecord(createRecordInput: CreateRecordInput!): Record
        createCmdrLog(createCmdrLogInput: CreateCmdrLogInput!): CmdrLogResult
      }

      type CmdrLogResult { id: ObjectID }
    `;

    // 4. Resolvers (Logic)
    const resolvers = {
        Query: {
            player: async (_, { id, roblox, upsert }) => {
                let p = id ? await Player.findById(id) : await Player.findOne({ roblox });
                if (!p && upsert && roblox) {
                    p = await Player.create({ roblox, cash: 500 }); // Starting cash
                }
                return p;
            },
            organisation: async (_, { id, name, group }) => {
                const query = {};
                if (id) query._id = id;
                if (name) query.name = name;
                if (group) query.groupId = group;
                return await Organisation.findOne(query).populate('bankAccount');
            },
            vehicle: async (_, { id, numberPlate }) => {
                return await Vehicle.findOne(id ? { _id: id } : { numberPlate });
            },
            records: async (_, { subject, type, take, skip }) => {
                const query = { subject };
                if (type) query.type = type;
                const records = await mongoose.model('Record').find(query).limit(take).skip(skip);
                const total = await mongoose.model('Record').countDocuments(query);
                return { records, total };
            }
        },
        Mutation: {
            createOrganisation: async (_, { createOrganisationInput }) => {
                const acct = await BankAccount.create({ balance: 0 });
                return await Organisation.create({ ...createOrganisationInput, bankAccount: acct._id, created: new Date().toISOString() });
            },
            createVehicle: async (_, { createVehicleInput }) => {
                return await Vehicle.create({ ...createVehicleInput, created: new Date().toISOString() });
            },
            updatePlayer: async (_, { id, updatePlayerInput }) => {
                return await Player.findByIdAndUpdate(id, updatePlayerInput, { new: true });
            }
            // Add other mutations similarly...
        }
    };

    // 5. Auth Bypass
    app.post('/auth/token', (req, res) => {
        res.json({ token: "session_valid", jobId: req.body.jobId });
    });

    const server = new ApolloServer({ typeDefs, resolvers, introspection: true });
    await server.start();
    server.applyMiddleware({ app, path: '/graphql' });

    const PORT = process.env.PORT || 4000;
    app.listen(PORT, () => console.log(`🚀 API running on port ${PORT}`));
}

startServer();