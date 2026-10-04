-- Database per service. One Postgres container keeps the laptop footprint small, but each service
-- has its own database and credentials scope and never reads another service's data.
CREATE DATABASE user_db;
CREATE DATABASE catalog_db;
CREATE DATABASE inventory_db;
CREATE DATABASE booking_db;
CREATE DATABASE payment_db;
CREATE DATABASE notification_db;
