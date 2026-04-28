-- Mothrly bookings table (PostgreSQL)
-- Apply after: CREATE DATABASE mothrly;
-- Or run: npm run setup:db

-- DROP TABLE IF EXISTS bookings;

CREATE TABLE IF NOT EXISTS bookings (
    id               SERIAL PRIMARY KEY,
    booking_id       VARCHAR(20) UNIQUE NOT NULL,
    name             VARCHAR(255) NOT NULL,
    customer_phone   VARCHAR(20),
    phone            VARCHAR(50),
    email            VARCHAR(255),
    description      TEXT,
    service_provider VARCHAR(100) NOT NULL,
    relationship     VARCHAR(100),
    payment_status   VARCHAR(50) DEFAULT 'pending',
    date             DATE NOT NULL,
    time             TIME NOT NULL,
    location         VARCHAR(255),
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(20);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_type VARCHAR(100);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS provider_name VARCHAR(100) DEFAULT 'no preference';

CREATE INDEX IF NOT EXISTS idx_bookings_booking_id ON bookings (booking_id);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings (created_at DESC);
