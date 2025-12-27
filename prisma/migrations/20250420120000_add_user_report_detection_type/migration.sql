-- Add user_report to detection_type enum
ALTER TYPE "detection_type" ADD VALUE IF NOT EXISTS 'user_report';
