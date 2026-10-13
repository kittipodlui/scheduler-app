 CREATE DATABASE IF NOT EXISTS study_scheduler
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE study_scheduler;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(32) NOT NULL UNIQUE,
  email VARCHAR(254) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS study_categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(60) NOT NULL,
  future_note TEXT NULL,
  lecture_notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_category (user_id, name),
  CONSTRAINT fk_category_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subjects (
  subject_key VARCHAR(32) PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  category_id BIGINT UNSIGNED NULL,
  kind VARCHAR(16) NOT NULL DEFAULT 'subject',
  label VARCHAR(80) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#64756d',
  weight TINYINT UNSIGNED NOT NULL DEFAULT 20,
  is_completed TINYINT(1) NOT NULL DEFAULT 0,
  sort_order TINYINT UNSIGNED NOT NULL,
  KEY idx_subject_owner (user_id),
  KEY idx_subject_category (category_id),
  CONSTRAINT fk_subject_owner FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_subject_category FOREIGN KEY (category_id) REFERENCES study_categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_subject_preferences (
  user_id BIGINT UNSIGNED NOT NULL,
  subject_key VARCHAR(32) NOT NULL,
  weight TINYINT UNSIGNED NOT NULL DEFAULT 20,
  is_added TINYINT(1) NOT NULL DEFAULT 0,
  future_note TEXT NULL,
  lecture_notes TEXT NULL,
  PRIMARY KEY (user_id, subject_key),
  CONSTRAINT fk_preference_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_preference_subject FOREIGN KEY (subject_key) REFERENCES subjects(subject_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schedules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  category_id BIGINT UNSIGNED NULL,
  days_per_week TINYINT UNSIGNED NOT NULL,
  sessions_per_day TINYINT UNSIGNED NOT NULL,
  start_time TIME NOT NULL DEFAULT '20:00:00',
  end_time TIME NOT NULL DEFAULT '22:00:00',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_schedules_user (user_id),
  KEY idx_schedule_category (category_id),
  CONSTRAINT fk_schedule_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_schedule_category FOREIGN KEY (category_id) REFERENCES study_categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_auth_sessions_user (user_id),
  CONSTRAINT fk_auth_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS study_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  schedule_id BIGINT UNSIGNED NOT NULL,
  day_index TINYINT UNSIGNED NOT NULL,
  session_index TINYINT UNSIGNED NOT NULL,
  subject_key VARCHAR(32) NOT NULL,
  is_completed TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY one_subject_per_slot (schedule_id, day_index, session_index),
  CONSTRAINT fk_session_schedule
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
  CONSTRAINT fk_session_subject
    FOREIGN KEY (subject_key) REFERENCES subjects(subject_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS manual_study_blocks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  subject_key VARCHAR(32) NOT NULL,
  day_index TINYINT UNSIGNED NOT NULL,
  start_time TIME NOT NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL,
  block_type ENUM('study', 'review', 'understanding', 'planning') NOT NULL DEFAULT 'study',
  is_completed TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_manual_blocks_category_day (user_id, category_id, day_index),
  CONSTRAINT fk_manual_block_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_manual_block_category FOREIGN KEY (category_id) REFERENCES study_categories(id) ON DELETE CASCADE,
  CONSTRAINT fk_manual_block_subject FOREIGN KEY (subject_key) REFERENCES subjects(subject_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS study_activities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  activity_type ENUM('study', 'homework', 'project', 'review') NULL DEFAULT NULL,
  course_key VARCHAR(32) NULL,
  activity_subject_key VARCHAR(32) NULL,
  title VARCHAR(100) NOT NULL,
  details TEXT NULL,
  weight TINYINT UNSIGNED NOT NULL DEFAULT 20,
  duration_hours DECIMAL(5,2) NOT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  start_time TIME NULL,
  end_time TIME NULL,
  is_completed TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_study_activities_owner (user_id, category_id, start_date),
  KEY idx_study_activities_course (course_key),
  KEY idx_study_activities_subject (activity_subject_key),
  CONSTRAINT fk_study_activity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_study_activity_category FOREIGN KEY (category_id) REFERENCES study_categories(id) ON DELETE CASCADE,
  CONSTRAINT fk_study_activity_course FOREIGN KEY (course_key) REFERENCES subjects(subject_key) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS study_schedule_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  schedule_id BIGINT UNSIGNED NULL,
  event_type ENUM('ga_generated', 'session_customized', 'session_completed', 'session_reopened', 'manual_block_added', 'manual_block_completed', 'manual_block_reopened', 'manual_block_removed') NOT NULL,
  details JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_schedule_events_owner (user_id, category_id, created_at),
  CONSTRAINT fk_schedule_event_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_schedule_event_category FOREIGN KEY (category_id) REFERENCES study_categories(id) ON DELETE CASCADE,
  CONSTRAINT fk_schedule_event_schedule FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
