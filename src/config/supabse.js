import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if(!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase environment variables are not set properly.");
}

export const supabaseAdmin = createClient(
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    }
);

// @param {string} accessToken - The access token of the user for whom you want to create a client.

export const getSupabaseForUser = (accessToken) => {
    return CreateClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        },
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
};

