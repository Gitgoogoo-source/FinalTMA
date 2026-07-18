create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists core;
create schema if not exists catalog;
create schema if not exists economy;
create schema if not exists inventory;
create schema if not exists gameplay;
create schema if not exists market;
create schema if not exists onchain;
create schema if not exists ops;
create schema if not exists api;
